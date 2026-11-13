import { MIN_WORDS } from "./config.js";

export const DEFAULTS = { auto: true, minWords: MIN_WORDS, tooltips: true };

const api = globalThis.browser ?? globalThis.chrome;

export async function readSettings() {
  const stored = await api.storage.local.get(["settings"]);
  return { ...DEFAULTS, ...(stored.settings ?? {}) };
}

export async function writeSettings(settings) {
  await api.storage.local.set({ settings });
}

export async function read(key) {
  return (await api.storage.local.get([key]))[key];
}
