import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // the validation scripts of finished steps stay byte for byte as their md5 freezes recorded them
    // (work/sNN/FREEZE_md5.txt), so two style rules that only flag unused code are off for them
    files: ["scripts/csv.ts", "scripts/s0[0-9]-*.{ts,mjs}", "scripts/s1[0-8]-*.{ts,mjs}"],
    rules: { "@typescript-eslint/no-unused-vars": "off", "@typescript-eslint/no-unused-expressions": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MediaPipe's own files, copied from its npm package at install (scripts/copy-mediapipe.mjs)
    "public/mediapipe/**",
    // Playwright's output
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
