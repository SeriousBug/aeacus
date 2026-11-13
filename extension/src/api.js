// The extension API of the browser that is running. Firefox calls it browser and Chrome calls it
// chrome, and from here they are the same shape, so one of them names the type.
const api = /** @type {typeof chrome} */ (globalThis.browser ?? globalThis.chrome);

export default api;
