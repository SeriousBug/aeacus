# Putting the extension in the stores

What each store takes, and what it asks for before it takes it. `pnpm zip` writes
`artifacts/aeacus-<browser>-<version>.zip` for Chrome and Firefox from a fresh build, with
`manifest.json` at the archive's root.

The weights are not in the package: the first check downloads 90 MB from Hugging Face, which both
stores will ask about, and both show readers that the extension reads every site.

## Chrome Web Store

1. Register at `https://chrome.google.com/webstore/devconsole`, one-time $5. The account's email
   cannot be changed later.
2. Add a new item and upload `artifacts/aeacus-chrome-<version>.zip`.
3. Fill the store listing: name, summary of 132 characters or fewer, description, category,
   language, and at least one screenshot at 1280×800 or 640×400. The 128×128 icon is in the package.
4. Fill the privacy practices tab, which is what review reads first:
   - Single purpose: marks the parts of a page that read as AI-written, with a model that runs on the
     reader's computer.
   - `storage` and `unlimitedStorage`: the model and the settings stay on the reader's computer.
   - Site access: text is read on the page being checked and nothing is uploaded.
   - Remote code: WebAssembly ships inside the package, and what is downloaded from Hugging Face is
     weights, not code.
   - Data usage: nothing is collected.
5. Link a privacy policy, which the site at `aeacus.bgenc.dev` does not have yet.
6. Submit for review, with distribution set to public and all regions.

## Firefox AMO

1. Sign in at `https://addons.mozilla.org` and submit a new add-on at
   `https://addons.mozilla.org/developers/addon/submit/distribution`, listed.
2. Upload `artifacts/aeacus-firefox-<version>.zip`.
3. Attach the source code when asked. AMO requires it whenever a bundler touches the code, and
   `build.mjs` bundles with esbuild. A source archive holds `extension/` without `node_modules` or
   `dist`, plus `shared/tokenizer.js`; the build instructions are `pnpm install --frozen-lockfile &&
   pnpm build`, which writes `dist/firefox`, and reviewers compare it against the upload. Dependencies
   come from npm, which the add-on policies allow.
4. Fill the listing: name, summary, description, category, screenshots, the MIT license, and a
   privacy policy.
5. Data collection is already declared `none` in the manifest, which AMO requires of new submissions.
6. Publish. Validation runs on upload; `background.scripts` is the Firefox spelling of an event page
   and the build writes it.

## Doing it from a script instead

Chrome's dashboard has an API behind it: an OAuth client ID and secret for the developer account,
plus a refresh token, upload the package and publish a draft. AMO has the same behind an API key and
secret from `https://addons.mozilla.org/developers/addon/api/key/`, with a JWT signed over the
request. Neither is set up here, and `web-ext` is not installed: a small Node script is enough for
AMO, and `fetch` against the Chrome Web Store API for Chrome.

## Safari

The Safari build is an app around the extension, which `pnpm safari` writes to `safari/` and Xcode
builds. `docs/safari.md` has the certificate, the app record and the upload.
