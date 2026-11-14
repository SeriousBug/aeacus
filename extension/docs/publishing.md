# Putting the extension in the stores

What each store takes, and what it asks for before it takes it. `pnpm zip` writes
`artifacts/aeacus-<browser>-<version>.zip` for Chrome and Firefox from a fresh build, with
`manifest.json` at the archive's root.

`pnpm art` draws the store artwork from the screenshots in `store/sources`, with the words kept
outside the frame of each shot: `store/art/screenshots` at 1280×800 for Chrome and AMO,
`store/art/mac` at 2560×1600 for the Mac, and `store/art/promo` for Chrome's 440×280 tile and
1400×560 marquee. It needs Chrome, ImageMagick and a font that has SF or Helvetica on it.
`store/art.json` holds the order of the shots, the address bar each one shows, its words and its
crop.

The weights are not in the package: the first check downloads 90 MB from Hugging Face, which both
stores will ask about, and both show readers that the extension reads every site.

## Chrome Web Store

1. Register at `https://chrome.google.com/webstore/devconsole`, one-time $5. The account's email
   cannot be changed later.
2. Add a new item and upload `artifacts/aeacus-chrome-<version>.zip`.
3. Fill the store listing: name, summary of 132 characters or fewer, description, category,
   language, and at least one screenshot at 1280×800 or 640×400. The 128×128 icon is in the package.
4. Fill the privacy practices tab, which is what review reads first. The dashboard refuses a
   submission without the single purpose, a justification per permission, and the data usage
   certification, so all of the text below goes in before the first submit, not after:

   Single purpose, 1000 characters at most:

   > Aeacus marks which parts of a web page read as AI-written and which read as written by a
   > person. The reader asks for a check from the toolbar button, the Alt+Shift+A shortcut, or the
   > small control on the page; the text of the page in view is scored, and the paragraphs and
   > comments it finds are tinted from likely human to likely AI. A model runs inside the extension
   > on the reader's own computer, so the page is never sent anywhere and nothing is stored off the
   > device.

   `storage`:

   > Keeps the reader's own settings and whether the model has finished downloading, so the
   > extension behaves the same on the next page. It holds a handful of fields in `storage.local`:
   > the score at which marks appear, the colours, whether checks run on their own, and one flag for
   > the downloaded model. Nothing leaves the computer, and the reader can clear it from the options
   > page.

   `unlimitedStorage`:

   > The checking model is a 90 MB file, kept in the extension's Cache Storage so it is downloaded
   > once. That storage shares the extension's quota, and a file this big can be evicted when the
   > quota fills, which would mean another 90 MB download. Unlimited storage keeps the weights in
   > place, and nothing else large is written.

   `offscreen`:

   > The model runs in a Web Worker, which a Chrome service worker cannot create. The offscreen
   > document exists to host that worker, opened with reason WORKERS, and it keeps the loaded model
   > between checks so a check does not download or load it again. It has no UI, reads no pages, and
   > only the extension's service worker talks to it.

   Site access, the same text for all four host permissions:

   > Downloads the model the first time a page is checked. It is three files from a public Hugging
   > Face repository, about 90 MB in total: `huggingface.co` serves the address, which redirects to
   > the other three, where Hugging Face keeps the weights. These are GET requests for the model;
   > nothing on the page is uploaded, and after the first check the copy in Cache Storage is read
   > instead.

   Remote code is answered no: WebAssembly ships inside the package, and what comes from Hugging
   Face is weights, not code. Under data usage, every data type stays unchecked and all three
   certifications are checked.
5. Submit for review, with distribution set to public and all regions. A privacy policy URL is only
   required once an item declares that it collects data, and this one declares nothing.

## Firefox AMO

1. Sign in at `https://addons.mozilla.org` and submit a new add-on at
   `https://addons.mozilla.org/developers/addon/submit/distribution`, listed.
2. Upload `artifacts/aeacus-firefox-<version>.zip`.
3. Attach the source code when asked. AMO requires it whenever a bundler touches the code, and
   `build.mjs` bundles with esbuild. A source archive holds `extension/` without `node_modules` or
   `dist`, plus `shared/tokenizer.js` and `LICENSE`; the build instructions are `pnpm install
   --frozen-lockfile && pnpm build`, which writes `dist/firefox`, and reviewers compare it against the
   upload. Dependencies come from npm, which the add-on policies allow.
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
