// esbuild alias stub — Node-only fs/path/zlib/crypto calls never run in the
// browser build: dictionaries + rule sets + layouts are injected, and the
// PDF/XLSX pipeline is out of scope for this package.
const fail = () => {
  throw new Error('node builtins are not available in the browser build');
};
export const existsSync = fail;
export const readFileSync = fail;
export const readdirSync = fail;
export const writeFileSync = fail;
export const readFile = fail;
export const statSync = fail;
export const join = fail;
export const dirname = fail;
export const inflateSync = fail;
export const createDecipheriv = fail;
export const createHash = fail;
export default {};
