// Catches what the tests could not: a name that shadows the one it calls, a `const` read before its
// own line, a global the extension has no business reaching for.
//   pnpm lint

import js from "@eslint/js";
import globals from "globals";

const rules = {
  "no-shadow": "error",
  // A function declaration is hoisted and may be called from anywhere; a `const` is not, and reading
  // one before its line throws.
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  "prefer-const": "error",
  "no-var": "error",
  eqeqeq: ["error", "always"],
  "no-throw-literal": "error",
  "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
};

export default [
  { ignores: ["dist/", "safari/", "build/", "test/perf/ort/"] },
  js.configs.recommended,
  {
    // The extension itself: the browser it runs in, and nothing from Node.
    files: ["src/**/*.js", "test/perf/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
        chrome: "readonly",
        browser: "readonly",
        AEACUS_MODEL_BASE: "readonly",
      },
    },
  },
  {
    files: ["build.mjs", "tools/**/*.mjs", "test/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  { rules },
];
