# Putting the extension in the stores

What each store takes, and what it asks for before it takes it. `pnpm release` writes all of it:
`pnpm zip` builds Chrome and Firefox into `artifacts/aeacus-<browser>-<version>.zip`, with
`manifest.json` at the archive's root, and `pnpm source` writes the source archive AMO asks for,
`artifacts/aeacus-<version>-source.zip`. The version in those names comes from `package.json`, which
is also the version the manifest carries.

`pnpm art` draws the store artwork from the screenshots in `store/sources`, with the words kept
outside the frame of each shot: `store/art/screenshots` at 1280×800 for Chrome and AMO,
`store/art/mac` at 2560×1600 for the Mac, `store/art/phone` at 1320×2868 and `store/art/tablet` at
2064×2752 for the iPhone and iPad, and `store/art/promo` for Chrome's 440×280 tile and 1400×560
marquee. It needs Chrome, ImageMagick and a font that has SF or Helvetica on it. `store/art.json`
holds the order of the shots, the address bar each one shows, its words and its crop.

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

   > Aeacus marks which paragraphs and comments on a page read as AI-written and which read as
   > written by a person. The reader asks for a check with the toolbar button or the Alt+Shift+A
   > shortcut, the text of the page in view is scored, and each block it found is tinted from
   > likely human to likely AI, with the score on hover. The model that does the scoring runs inside
   > the extension on the reader's own computer, so the text is never sent anywhere and nothing is
   > stored off the device.

   `activeTab`:

   > Aeacus draws its marks on the page the reader is reading, so it has to read that page's words:
   > the prose, the reviews, the comments. It reads them only on the ask, from the toolbar button
   > or the shortcut, and only from the tab in front of the reader at that moment. Nothing is read
   > at start-up, in the background, or on a tab nobody checked, so there is no reason for the
   > extension to hold access to sites of its own.

   `scripting`:

   > The script that gathers the page's prose and draws the marks goes into the tab when a check is
   > asked for, rather than sitting on every page the reader visits. The styles for the marks go in
   > with it, so nothing on the page changes before the reader asks.

   `storage`:

   > Keeps four small things the extension needs on the next visit: whether checks may use the GPU,
   > whether the debug log is verbose, whether the model has finished downloading, and which theme
   > the reader picked. Whether the model has downloaded is what makes the toolbar button say
   > "Check this page" instead of "Download Aeacus". They are a few small values on the reader's
   > computer, sent nowhere, and they go when the extension is removed.

   `unlimitedStorage`:

   > The model is a 90 MB file, and Aeacus keeps it in the browser's local cache so a check costs no
   > download after the first. That cache falls under the storage an extension is given, and a file
   > this big can be evicted when it fills, which would leave the reader downloading 90 MB again.
   > Nothing else Aeacus writes is large.

   `offscreen`:

   > Scoring takes a worker thread, and the extension's background service worker cannot start one.
   > This document exists for that worker: it loads the model once, keeps it loaded so the next
   > check starts straight away, and hands the scores back. It has no window, touches no page, and
   > sees only the text blocks it is asked to score.

   Site access, the same text for all four host permissions:

   > The model comes from a public Hugging Face repository, and this lets the browser fetch it on
   > the first check: the 90 MB weights, a tokenizer, and a thresholds file. huggingface.co serves
   > the address and redirects to the CDN hosts, which is why all four are listed. The requests ask
   > for those files and carry no page text, and after the first check the copy in the local cache
   > is read instead.

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
   `build.mjs` bundles with esbuild. `pnpm source` writes `artifacts/aeacus-<version>-source.zip`: the
   extension's own files without `node_modules` or `dist`, plus `shared/tokenizer.js`, `LICENSE`, and a
   README that says how to build it, from `docs/amo-source.md` with the version and the tool versions
   filled in. The build is `pnpm install --frozen-lockfile && pnpm build firefox`, which writes
   `dist/firefox`, and reviewers compare it against the upload. Dependencies come from npm, which the
   add-on policies allow.
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
builds. The same project holds an iOS app and a macOS app under one bundle identifier, so one App
Store record created with both platforms sells them as a universal purchase. `docs/safari.md` has
the certificate, the app record, the upload and the listing.
