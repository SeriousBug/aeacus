const KEY = "aeacus:theme";

/**
 * Puts a theme on this page, and leaves it where theme-boot.js can read it without waiting on
 * storage, which is what keeps the next popup from painting the theme this one replaced.
 * @param {Theme} theme
 */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
}
