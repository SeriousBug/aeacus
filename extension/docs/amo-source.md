# Aeacus {{version}}, source for the Firefox add-on

This archive holds the source that `aeacus-firefox-{{version}}.zip` is built from. Nothing here is
minified or transpiled: `src/` is the code as it is written, and the build bundles it with esbuild so
that each entry point loads as one file.

## What the build needs

- Node.js {{node}}, the version this build was made with. Any recent release works.
- pnpm {{pnpm}}, to install the pinned dependencies:
  `npm install --global pnpm@{{pnpm}}`, or `corepack enable`.
- macOS or Linux. esbuild ships its own binaries, so no compiler or other build tool is installed.

The model is not part of the add-on: it is downloaded from `huggingface.co/level20tauren/aeacus-s-1`
the first time the reader checks a page. The build itself needs no network beyond npm.

## Build

```sh
cd extension
pnpm install --frozen-lockfile
pnpm build firefox
```

`pnpm build firefox` runs `node build.mjs firefox`, which writes `extension/dist/firefox/`. The
contents of that folder are what the add-on package holds, with `manifest.json` at its root.

## Layout

- `extension/src`: the extension's code, including the popup, the options page, the content script
  that marks a page and the worker that runs the model.
- `extension/manifests`: the per-browser parts of `manifest.json`, merged with `base.json` at build.
- `shared/tokenizer.js`: the tokenizer, shared with the website and the CLI in the same repository.
- `LICENSE`: MIT.
