/**
 * Copyright 2026 Kapil — Project Panini Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * FIU-side POST /Consent/Notification validation.
 *
 * The certification scenarios hammer this endpoint — wrong notifier,
 * stale timestamps, unknown versions — because it is where an FIU could
 * be tricked into trusting a consent state change that never happened.
 * This is a pure validator over the notification body: it tells you
 * whether to accept and which spec error code to answer with, so your
 * endpoint stays a thin shell around it.
 */

import type { ConsentStatus } from './types';

/** The notification body as POSTed by the AA. */
export interface ConsentNotification {
  readonly ver: string;
  readonly timestamp: string;
  readonly txnid: string;
  readonly Notifier: {
    readonly type: string;
    readonly id: string;
  };
  readonly ConsentStatusNotification: {
    readonly consentId: string;
    readonly consentHandle: string;
    readonly consentStatus: ConsentStatus | string;
    readonly signature?: string;
  };
}

export type NotificationErrorCode =
  | 'InvalidRequest'
  | 'InvalidConsentHandle'
  | 'InvalidConsentId'
  | 'InvalidConsentStatus'
  | 'InvalidNotifier'
  | 'NoSuchVersion';

export interface NotificationRejection {
  readonly httpStatus: 400 | 404;
  readonly errorCode: NotificationErrorCode;
  readonly message: string;
}

export interface NotificationVerdict {
  /** True → ack the notification and apply the consent-status change. */
  readonly ok: boolean;
  readonly rejection?: NotificationRejection;
  /** Extracted fields when ok — update your consent store with these. */
  readonly consentId?: string;
  readonly consentHandle?: string;
  readonly consentStatus?: ConsentStatus;
  /** Reflect this into the ack response's `txnid`. */
  readonly txnid?: string | undefined;
}

export interface NotificationValidatorOpts {
  /** The AA spec version this FIU serves. Default '2.0.0'. */
  readonly specVersion?: string;
  /** AA ids allowed to notify this endpoint (e.g. ['finvu']). When
   *  provided, any other notifier is rejected as InvalidNotifier —
   *  strongly recommended: without it, any body claiming to be an AA is
   *  trusted. */
  readonly allowedNotifierIds?: readonly string[];
  /** Clock for tests; defaults to now. */
  readonly now?: Date;
  /** Allowed |now − notification.timestamp| skew. Default 15 min —
   *  the certification's replay window. */
  readonly timestampToleranceMs?: number;
}

const KNOWN_STATUSES = new Set<string>([
  'PENDING',
  'ACTIVE',
  'PAUSED',
  'REVOKED',
  'EXPIRED',
  'REJECTED',
  'FAILED',
]);

function reject(
  httpStatus: 400 | 404,
  errorCode: NotificationErrorCode,
  message: string,
  txnid?: string,
): NotificationVerdict {
  return { ok: false, rejection: { httpStatus, errorCode, message }, txnid };
}

/**
 * Validate an inbound consent notification. Order follows the spec's
 * expectations: version → shape → timestamp → notifier → ids → status.
 */
export function validateConsentNotification(
  body: unknown,
  opts: NotificationValidatorOpts = {},
): NotificationVerdict {
  const specVersion = opts.specVersion ?? '2.0.0';
  const tolerance = opts.timestampToleranceMs ?? 15 * 60 * 1000;
  const now = (opts.now ?? new Date()).getTime();

  if (typeof body !== 'object' || body === null) {
    return reject(400, 'InvalidRequest', 'notification body is not an object');
  }
  const n = body as Record<string, unknown>;
  const txnid = typeof n['txnid'] === 'string' ? n['txnid'] : undefined;

  if (n['ver'] !== specVersion) {
    return reject(404, 'NoSuchVersion', `unsupported spec version '${String(n['ver'])}'`, txnid);
  }
  if (typeof n['timestamp'] !== 'string' || typeof n['txnid'] !== 'string' || txnid === '') {
    return reject(400, 'InvalidRequest', 'missing or malformed timestamp/txnid', txnid);
  }
  const ts = Date.parse(n['timestamp']);
  if (Number.isNaN(ts) || Math.abs(ts - now) > tolerance) {
    return reject(400, 'InvalidRequest', 'timestamp outside tolerance — possible replay', txnid);
  }

  const notifier = n['Notifier'];
  if (typeof notifier !== 'object' || notifier === null) {
    return reject(400, 'InvalidRequest', 'missing Notifier', txnid);
  }
  const nt = notifier as Record<string, unknown>;
  if (nt['type'] !== 'AA') {
    return reject(
      400,
      'InvalidNotifier',
      `notifier type '${String(nt['type'])}' — expected 'AA'`,
      txnid,
    );
  }
  if (typeof nt['id'] !== 'string' || nt['id'] === '') {
    return reject(400, 'InvalidNotifier', 'missing Notifier.id', txnid);
  }
  if (opts.allowedNotifierIds !== undefined && !opts.allowedNotifierIds.includes(nt['id'])) {
    return reject(400, 'InvalidNotifier', `notifier '${nt['id']}' is not an allowed AA`, txnid);
  }

  const csn = n['ConsentStatusNotification'];
  if (typeof csn !== 'object' || csn === null) {
    return reject(400, 'InvalidRequest', 'missing ConsentStatusNotification', txnid);
  }
  const c = csn as Record<string, unknown>;
  if (typeof c['consentId'] !== 'string' || c['consentId'] === '') {
    return reject(400, 'InvalidConsentId', 'missing consentId', txnid);
  }
  if (typeof c['consentHandle'] !== 'string' || c['consentHandle'] === '') {
    return reject(400, 'InvalidConsentHandle', 'missing consentHandle', txnid);
  }
  if (typeof c['consentStatus'] !== 'string' || !KNOWN_STATUSES.has(c['consentStatus'])) {
    return reject(
      400,
      'InvalidConsentStatus',
      `unknown consentStatus '${String(c['consentStatus'])}'`,
      txnid,
    );
  }

  return {
    ok: true,
    consentId: c['consentId'],
    consentHandle: c['consentHandle'],
    consentStatus: c['consentStatus'] as ConsentStatus,
    txnid,
  };
}

/**
 * The HTTP-200 ack body a compliant FIU returns on an accepted
 * notification — echoes the request txnid per spec.
 */
export function consentNotificationAck(
  txnid: string,
  specVersion = '2.0.0',
): { ver: string; timestamp: string; txnid: string; response: 'OK' } {
  return { ver: specVersion, timestamp: new Date().toISOString(), txnid, response: 'OK' };
}
