/**
 * Copyright 2026 Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { EnterpriseProxy } from '../enterpriseProxy';

/**
 * Minimal structural request shape — satisfied by Node's IncomingMessage
 * and by Express/Fastify request objects. `body` is honoured when a
 * body-parsing middleware ran first; otherwise the stream is read.
 */
export interface HttpLikeRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Minimal structural response shape — satisfied by ServerResponse. */
export interface HttpLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
}

export type HttpMiddleware = (
  req: HttpLikeRequest,
  res: HttpLikeResponse,
  next?: () => void,
) => void;

export interface HttpAdapterOptions {
  readonly proxy: EnterpriseProxy;
  /** Route path to intercept. Default '/v1/parse'. */
  readonly path?: string;
  /** Maximum accepted request body size. Default 256 KiB. */
  readonly maxBodyBytes?: number;
}

const DEFAULT_PATH = '/v1/parse';
const DEFAULT_MAX_BODY = 256 * 1024;

function headerValue(headers: HttpLikeRequest['headers'], name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value[0];
    }
  }
  return undefined;
}

/** Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`. */
function extractApiKey(req: HttpLikeRequest): string | undefined {
  const apiKey = headerValue(req.headers, 'x-api-key');
  if (apiKey !== undefined && apiKey.trim().length > 0) return apiKey.trim();
  const auth = headerValue(req.headers, 'authorization');
  if (auth !== undefined) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1];
  }
  return undefined;
}

function urlPath(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

function readBody(
  req: HttpLikeRequest,
  maxBodyBytes: number,
): Promise<{ ok: true; raw: string } | { ok: false; status: 413; error: string }> {
  return new Promise((resolve, reject) => {
    if (req.on === undefined) {
      // No stream interface (already-consumed body or tests).
      resolve({ ok: true, raw: '' });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: unknown) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > maxBodyBytes) {
        resolve({
          ok: false,
          status: 413,
          error: `payload exceeds ${maxBodyBytes} bytes`,
        });
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve({ ok: true, raw: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', (err: unknown) => reject(err as Error));
  });
}

function sendJson(
  res: HttpLikeResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (headers) {
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  }
  res.end(JSON.stringify(body));
}

/**
 * Creates an Express/Fastify/plain-http compatible middleware that exposes
 * the EnterpriseProxy as a POST endpoint:
 *
 *   POST /v1/parse
 *   x-api-key: <key>            (or Authorization: Bearer <key>)
 *   <body: narration string or AA-style JSON payload>
 *
 * Pipeline: auth header → token bucket → local tokenizer → billing meter
 * (records payload byte size) → optional opt-in telemetry.
 */
export function createPaniniHttpHandler(options: HttpAdapterOptions): HttpMiddleware {
  const path = options.path ?? DEFAULT_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const { proxy } = options;

  return function paniniHttpHandler(req, res, next) {
    if ((req.method ?? 'GET') !== 'POST' || urlPath(req.url) !== path) {
      if (next !== undefined) {
        next();
        return;
      }
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    void (async () => {
      const apiKey = extractApiKey(req);

      // Body source: pre-parsed `req.body` (Express JSON) wins; otherwise
      // stream the request and decode.
      let payload: unknown;
      let payloadBytes: number;
      if (req.body !== undefined) {
        payload = req.body;
        payloadBytes =
          typeof req.body === 'string'
            ? Buffer.byteLength(req.body)
            : Buffer.byteLength(JSON.stringify(req.body));
      } else {
        const body = await readBody(req, maxBodyBytes);
        if (!body.ok) {
          sendJson(res, body.status, { error: body.error });
          return;
        }
        payloadBytes = Buffer.byteLength(body.raw);
        const trimmed = body.raw.trim();
        if (trimmed.length > 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            payload = JSON.parse(trimmed) as unknown;
          } catch {
            sendJson(res, 400, { error: 'malformed JSON body' });
            return;
          }
        } else {
          payload = body.raw;
        }
      }

      if (
        payload === undefined ||
        payload === null ||
        (typeof payload === 'string' && payload.trim().length === 0)
      ) {
        sendJson(res, 400, { error: 'empty request body' });
        return;
      }

      const meta = { payloadBytes };
      const result =
        typeof payload === 'string'
          ? proxy.parse(apiKey, payload, meta)
          : proxy.parsePayload(apiKey, payload, meta);

      if (!result.ok) {
        sendJson(
          res,
          result.status,
          { error: result.error },
          result.retryAfterMs !== undefined
            ? { 'retry-after': String(Math.ceil(result.retryAfterMs / 1000)) }
            : undefined,
        );
        return;
      }
      sendJson(res, 200, result.data);
    })().catch((err: unknown) => {
      sendJson(res, 500, { error: `internal error: ${(err as Error).message}` });
    });
  };
}
