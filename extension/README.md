# Aeacus browser extension

Marks the parts of a page that read as written by AI. Aeacus runs on the computer it is installed
on: the model is downloaded once from Hugging Face, kept in the browser's cache, and read there, so
no page text leaves the machine.

## Build

From `extension/`:

```sh
pnpm install
pnpm build
```

`pnpm build` writes `dist/chrome`, `dist/firefox` and `dist/safari`, each a complete extension with
its own manifest. `pnpm test` runs the Node tests, which need no browser; they skip the model tests
when the weights are not at `../../publish/aeacus-s-1`, or wherever `AEACUS_WEIGHTS` points.

## Load it in a browser

Chrome: open `chrome://extensions`, turn on Developer mode, choose "Load unpacked", and pick
`dist/chrome`.

Firefox: open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on", and pick
`dist/firefox/manifest.json`.

Safari: `pnpm safari` builds `dist/safari` and converts it into the Xcode project in `safari/`,
which Xcode builds and runs as a small app holding the extension; turn the extension on in Safari's
settings afterwards. Running it again regenerates the project, so changes made inside Xcode are
lost. The project points at `dist/safari` rather than copying it.

## How it fits together

The content script reads the page and reports back; the model runs in a worker held by a document
of its own. That last part is what the browser decides: a service worker gets no WebGPU and is shut
down when idle, while a document has both, so Chrome hosts the worker in an offscreen document and
Firefox and Safari in the background document. Where a browser has no `Worker` at all, the service
worker runs the model itself over WebAssembly.

| File | What it does |
| --- | --- |
| `src/page-text.js` | Finds the prose on a page, and cuts a container that holds a whole article into pieces a 510-token window can read |
| `src/highlight.js` | Paints the scores back over the text with the CSS Custom Highlight API, so the page is never changed |
| `src/content.js` | Runs a check: gather the text, ask the background, paint and report to the popup |
| `src/infer.js` | The model: download and cache, session on WebGPU or WebAssembly, windows and scores |
| `src/host.js` | Runs `infer.js` in a worker, or in place when the browser has none |
| `src/background.js` | Connects each page to the document that holds the worker |
| `src/scoring.js` | Thresholds, calibration and the page-level numbers, the same as the website and the CLI |

`src/` is shared by all three browsers; only `manifests/` differs. `build.mjs` merges
`manifests/base.json` with the browser's own file, bundles each entry point with esbuild, and copies
the ONNX Runtime files the model needs.

Set `AEACUS_MODEL_BASE` when building to load the model from somewhere else, which is how a local
copy of the weights is tested:

```sh
AEACUS_MODEL_BASE=http://localhost:8799/ pnpm build
```

## Permissions

`storage` holds the settings and whether the model is downloaded; `unlimitedStorage` lets the 87 MB
weights sit in the cache. The host permissions are for the Hugging Face addresses the model comes
from. Nothing is sent anywhere.
