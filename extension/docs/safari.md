# Building the Safari app

Safari has no unpacked extension to load: an extension ships inside a small app, and `pnpm safari`
converts `dist/safari` into the Xcode project in `safari/`, which Xcode builds. The project points at
`dist/safari` instead of copying it, so a rebuild is picked up without converting again, and
converting again regenerates the project, losing any change made inside Xcode.

The converter names the app's bundle identifier with the app name's case, which puts
`dev.bgenc.aeacus.Extension` inside an app called `dev.bgenc.Aeacus`, and Xcode stops the build at
`ValidateEmbeddedBinary` because the extension's identifier is not prefixed by its parent's.
`tools/safari.mjs` rewrites both targets to the identifier it was given.

```sh
pnpm safari
xcodebuild -project safari/Aeacus/Aeacus.xcodeproj -scheme Aeacus -configuration Release \
  -archivePath build/aeacus.xcarchive archive
```

## What the App Store wants

- An Apple Distribution certificate. The team here is `63QQLP356Q`, which Xcode is signed into, so
  `-allowProvisioningUpdates` on the archive creates the certificate and the profiles for
  `dev.bgenc.aeacus` and `dev.bgenc.aeacus.Extension`.
- An app record in App Store Connect: platform macOS, name Aeacus, bundle identifier
  `dev.bgenc.aeacus`, a SKU and a primary language. The API cannot create one.
- An upload from Xcode's Organizer (Distribute App, App Store Connect) or with an App Store Connect
  API key at `~/.appstoreconnect/private_keys`, which neither `altool` nor `notarytool` has here.
- A privacy policy URL, screenshots, a category, and the app's privacy answers. The extension
  declares no data collection, and the weights are downloaded from Hugging Face on first use, which
  review asks about.

The app's `MARKETING_VERSION` is 1.0 while the extension reports the version in `package.json`; the
two are independent, and App Store versions only move forward.
