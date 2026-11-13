import api from "./api.js";

/** @type {Settings} */
export const DEFAULTS = { gpu: true };

/** @returns {Promise<Settings>} */
export async function readSettings() {
  const stored = await api.storage.local.get(["settings"]);
  return { ...DEFAULTS, ...(stored.settings ?? {}) };
}

/** @param {Settings} settings */
export async function writeSettings(settings) {
  await api.storage.local.set({ settings });
}
