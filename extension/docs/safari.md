# Building the Safari app

Safari has no unpacked extension to load: an extension ships inside a small app, and `pnpm safari`
converts `dist/safari` into the Xcode project in `safari/`, which Xcode builds. The project points at
`dist/safari` instead of copying it, so a rebuild is picked up without converting again, and
converting again regenerates the project, losing any change made inside Xcode.

The converter is given neither `--macos-only` nor `--ios-only`, so the project carries an app and an
extension for each platform, `Aeacus (macOS)` and `Aeacus (iOS)`, sharing one group of extension
sources and the same bundle identifiers. That is what an App Store record selling both needs.

The converter names the app's bundle identifier with the app name's case, which puts
`dev.bgenc.aeacus.Extension` inside an app called `dev.bgenc.Aeacus`, and Xcode stops the build at
`ValidateEmbeddedBinary` because the extension's identifier is not prefixed by its parent's.
`tools/safari.mjs` rewrites both targets to the identifier it was given.

```sh
pnpm safari
xcodebuild -project safari/Aeacus/Aeacus.xcodeproj -scheme "Aeacus (macOS)" -configuration Release \
  -archivePath build/aeacus.xcarchive archive
```

The iOS app builds the same way with `-scheme "Aeacus (iOS)" -destination 'generic/platform=iOS
Simulator'`, which is how to see it without a device.

## Testing it locally

`pnpm safari` rebuilds `dist/safari` and regenerates the project, so it is only needed when the
extension's own sources changed; a plain build picks up a new `dist/safari` without it.

```sh
xcodebuild -project safari/Aeacus/Aeacus.xcodeproj -scheme "Aeacus (macOS)" -configuration Debug \
  -derivedDataPath build/dd build -allowProvisioningUpdates DEVELOPMENT_TEAM=63QQLP356Q
cp -R build/dd/Build/Products/Debug/Aeacus.app /Applications
open /Applications/Aeacus.app
```

The project carries no team, so a build without `DEVELOPMENT_TEAM` falls back to "Sign to Run
Locally", which is ad hoc: Safari then loads the extension only with Develop > Allow Unsigned
Extensions ticked, and that resets every time Safari starts. With the team it is signed with the
Apple Development certificate, which needs no provisioning profile and no toggle.

Copying the app to `/Applications` keeps it where LaunchServices found it; a build directory in
`/tmp` goes away and takes Safari's copy of the extension with it. Safari lists the extension after
the app has run once. Then Safari > Settings > Extensions > Aeacus, and a check on any page, which
downloads the weights from Hugging Face the first time.

Xcode does the same by hand: open `safari/Aeacus/Aeacus.xcodeproj`, set the team under Signing &
Capabilities on both targets, and Run.

For a phone or a tablet, build the iOS scheme into the simulator, install and launch it:

```sh
xcodebuild -project safari/Aeacus/Aeacus.xcodeproj -scheme "Aeacus (iOS)" -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios build
xcrun simctl boot "iPhone 16 Pro"
xcrun simctl install booted build/ios/Build/Products/Debug-iphonesimulator/Aeacus.app
xcrun simctl launch booted dev.bgenc.aeacus
xcrun simctl io booted screenshot build/ios/shot.png
```

The extension turns on in Settings > Apps > Safari > Extensions, and a check starts from the Aa menu,
because `commands`, the Alt+Shift+A shortcut, has no iOS counterpart.

## What the App Store wants

- A distribution signature. Archiving signs with Apple Development, and `-exportArchive` below
  re-signs with a cloud-managed Apple Distribution certificate and a "Mac Team Store Provisioning
  Profile" for `dev.bgenc.aeacus`, both made on the fly through the team `63QQLP356Q` that Xcode is
  signed into. Nothing lands in the keychain, so this works on a machine with no distribution
  certificate.

  ```sh
  xcodebuild -exportArchive -archivePath build/aeacus.xcarchive -exportPath build/export \
    -exportOptionsPlist docs/export-options.plist -allowProvisioningUpdates
  ```

  `build/export/Aeacus.pkg` is the upload, and `DistributionSummary.plist` beside it records which
  certificate and profile signed what.
- An app record in App Store Connect: name Aeacus, bundle identifier `dev.bgenc.aeacus`, a SKU and
  a primary language. The API cannot create one. Create it with platform **iOS** and the macOS
  version is added to the same record, which is the direction universal purchase works in: Apple's
  help on adding platforms lets macOS, tvOS and visionOS join an existing iOS app, sharing its
  Apple ID, SKU and bundle ID, and says records cannot be merged afterwards. Uploading the macOS
  build with the same bundle identifier is what attaches it.
- An upload of `Aeacus.pkg` from Xcode's Organizer (Distribute App, App Store Connect) or from the
  command line, which needs an App Store Connect API key at `~/.appstoreconnect/private_keys` that
  is not set up here. The iOS build uploads the same way, with `-t ios`:

  ```sh
  xcrun altool --upload-app -f build/export/Aeacus.pkg -t macos \
    --apiKey <key id> --apiIssuer <issuer id>
  ```
- A privacy policy URL, screenshots, a category, and the app's privacy answers. The extension
  declares no data collection, and the weights are downloaded from Hugging Face on first use, which
  review asks about. `pnpm art` writes the Mac screenshots to `store/art/mac` at 2560×1600, the
  6.9-inch iPhone ones to `store/art/phone` at 1320×2868, and the 13-inch iPad ones to
  `store/art/tablet` at 2064×2752.

The app's `MARKETING_VERSION` is 1.0 while the extension reports the version in `package.json`; the
two are independent, and App Store versions only move forward. `CURRENT_PROJECT_VERSION` is 1 and
has to go up for every upload that reaches App Store Connect.

## The listing

Name `Aeacus`. Subtitle, 30 characters at most:

> Check text for AI writing

Promotional text, 170 at most, and the one field that changes without waiting for review:

> Marks the paragraphs, reviews and comments on a page that read as AI-written, so you can tell a
> person's review from a generated one. Everything runs on your Mac.

Keywords, 100 at most, comma separated:

> ai detector,ai writing,ai text,generated text,fake reviews,chatgpt,writing checker

Description:

> Aeacus marks which paragraphs, reviews and comments on a page read as AI-written and which read as
> written by a person.
>
> Ask for a check with the toolbar button or Alt+Shift+A, and the text in view is scored. Each block
> comes back tinted from likely human to likely AI, with the score on hover.
>
> It works where you already read: store reviews, restaurant reviews, forum threads, newsletters,
> blog comments.
>
> Nothing leaves your Mac. The model that does the scoring runs inside the extension, the text of
> the page is never uploaded, and there is no account to make. The first check downloads the model
> once and keeps it on your device after that.
>
> The same check is at aeacus.bgenc.dev if you would rather paste text, and the model is public at
> huggingface.co/level20tauren/aeacus-s-1.

Support URL `https://github.com/SeriousBug/aeacus/issues`, marketing URL `https://aeacus.bgenc.dev`,
privacy policy `https://aeacus.bgenc.dev/privacy.html`, category Productivity, price free, App
Privacy "Data Not Collected". Screenshots are the seven at 2560×1600 that `pnpm art` writes to
`store/art/mac`, and the iPhone and iPad versions of the same seven beside them in `store/art/phone`
and `store/art/tablet`.

Notes for review, which is where the download and the extension both get explained:

> Aeacus is a Safari web extension, and the app is the small window that holds it. To try it: open
> the app, then Safari > Settings > Extensions > Aeacus, tick it, and press Alt+Shift+A on any page.
> The page's paragraphs and comments come back tinted.
>
> The first check downloads about 90 MB from huggingface.co: the model's weights, a tokenizer and a
> thresholds file, all data. No executable code is fetched, and WebAssembly that runs the model ships
> inside the extension bundle. Later checks read the copy kept on the Mac.
>
> Nothing is collected. Page text is scored on the device and never sent anywhere, which is why the
> App Privacy answers are empty and the app asks for no account.

Two answers that are judgement calls rather than lookups: content rights, where the app bundles MIT
and Apache licensed code and MIT licensed weights, and the age rating, where the questionnaire's
unrestricted web access question is about apps that are themselves browsers, which this is not.
