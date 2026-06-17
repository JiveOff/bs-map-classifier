// Empty stubs for Node.js built-ins that bsmap's shims import.
// These are only used by bsmap's filesystem read/write helpers, which we
// never call from the browser — only NoteJumpSpeed and swing.count are used.
export default {};
export const join = () => '';
export const resolve = () => '';
export const dirname = () => '';
export const basename = () => '';
export const extname = () => '';
export const sep = '/';
export const readFile = () => Promise.reject(new Error('not available in browser'));
export const writeFile = () => Promise.reject(new Error('not available in browser'));
export const mkdir = () => Promise.reject(new Error('not available in browser'));
export const existsSync = () => false;
export const readdirSync = () => [];
export const readFileSync = () => '';
export const statSync = () => { throw new Error('not available in browser'); };
