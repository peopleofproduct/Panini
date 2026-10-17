// esbuild alias stub — Node-only fs/path calls never run in the browser
// build (dictionaries and rule sets are injected at bundle time).
const fail = () => {
  throw new Error('node:fs/path not available in browser build');
};
export const existsSync = fail;
export const readFileSync = fail;
export const readdirSync = fail;
export const join = fail;
export const readFile = fail;
export const statSync = fail;
