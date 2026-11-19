import api from "./api.js";

/** @type {Settings} */
export const DEFAULTS = { gpu: true, verbose: false, theme: "system" };

/** @returns {Promise<Settings>} */
export async function readSettings() {
  const stored = await api.storage.local.get(["settings"]);
  return { ...DEFAULTS, ...(stored.settings ?? {}) };
}

// One setting at a time, merged into what is already stored, so a page that saves the GPU choice
// leaves the others where they were.
/** @param {Partial<Settings>} update @returns {Promise<void>} */
export async function writeSettings(update) {
  const settings = await readSettings();
  await api.storage.local.set({ settings: { ...settings, ...update } });
}
