// A plain script in the head, so it has run before the first frame is drawn: a reader who picked a
// theme that differs from their system does not see the other one flash past. `theme.js` writes
// this key whenever the setting changes, and storage is read later to correct it.
document.documentElement.dataset.theme = localStorage.getItem("aeacus:theme") ?? "system";
