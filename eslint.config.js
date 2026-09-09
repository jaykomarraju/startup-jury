import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".wrangler/**",
      "playwright-report/**",
      "test-results/**",
      "worker-configuration.d.ts",
      // Nested git worktrees carry a second copy of the project, tsconfig and
      // all, which makes typescript-eslint fail every file in them with
      // "multiple candidate TSConfigRootDirs". They are checkouts of code that
      // is linted where it lives, so never lint them here. The parity
      // programme's own worktrees live outside the repo (`../sj-*`); this
      // covers the ones the harness creates inside it.
      ".claude/worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Standalone Node scripts (e.g. the post-deploy smoke test) run under the
    // Node runtime, not the bundler — declare the runtime globals they use.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
      },
    },
  },
);
