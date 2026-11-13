import { MIN_WORDS } from "./config.js";
import api from "./api.js";

// Checks are asked for, not assumed: a page is read when the button or the shortcut says so.
/** @type {Settings} */
export const DEFAULTS = { auto: false, minWords: MIN_WORDS, tooltips: true };

/** @returns {Promise<Settings>} */
export async function readSettings() {
  const stored = await api.storage.local.get(["settings"]);
  return { ...DEFAULTS, ...(stored.settings ?? {}) };
}

/** @param {Settings} settings */
export async function writeSettings(settings) {
  await api.storage.local.set({ settings });
}

/** @param {string} key */
export async function read(key) {
  return (await api.storage.local.get([key]))[key];
}
