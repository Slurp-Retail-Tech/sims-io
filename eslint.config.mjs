import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "eslint.config.mjs",
    // design-sync build output and staged converter scripts.
    "ds-bundle/**",
    ".ds-sync/**",
    ".design-sync/**",
    // CI scripts are plain Node .mjs, outside the Next.js lint surface.
    ".github/**",
    // Agent worktrees are full checkouts with their own build output; linting
    // them from the main checkout reports thousands of unrelated errors.
    ".claude/**",
  ]),
]);

export default eslintConfig;
