import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "dist-server/**", "dist-native/**", "release/**", "electron/vendor/**", "*.bak", ".agents/**", ".claude/**"] },
  {
    files: ["server/**/*.ts", "src/**/*.{ts,tsx}", "electron/**/*.{mjs,cjs}", "scripts/*.mjs"],
    languageOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript handles these for TS; node --check covers JS syntax.
      "no-undef": "off", "no-unused-vars": "off", "no-empty": ["error", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["server/api-security.ts", "server/http.ts", "server/routes/**/*.ts", "src/lib/api-auth.ts", "src/lib/authenticated-events.ts"],
    languageOptions: { parserOptions: { project: ["./tsconfig.json", "./tsconfig.server.json"], tsconfigRootDir: import.meta.dirname } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error", "@typescript-eslint/no-misused-promises": "error" },
  },
);
