# Aeacus

Aeacus estimates how AI-like a passage of writing is. The website is at [aeacus.bgenc.dev](https://aeacus.bgenc.dev).

This repository is a monorepo containing the website source in `website/` and the npm CLI package in `cli/`. GitHub Actions builds and deploys the website to GitHub Pages and publishes versioned CLI releases to npm.

## Website

The website uses Vite. From `website/`, install dependencies and start the development server:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Production builds load `tokenizer.json`, `thresholds.json`, and `onnx/model_q4f16.onnx` from the Aeacus model repository on Hugging Face. For local development, set `MODEL_DIR` to a directory containing those files.

## CLI

The `aeacus-cli` package provides the `aeacus` command. It reads from stdin or a file and emits a readable summary by default. Use `--json` for structured results or `--porcelain` for tab-separated summary fields. See [cli/README.md](cli/README.md) for details.

The npm package has not been bootstrapped yet. Publish its initial version once from an npm-authenticated environment, then configure npm Trusted Publishing for the `SeriousBug/aeacus` repository and `publish-cli.yml`. After that, push a `cli-v<version>` tag matching `cli/package.json` to build and publish a release from GitHub Actions.
