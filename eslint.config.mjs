import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noHardcodedDesignValues from "./eslint-rules/no-hardcoded-design-values.mjs";

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
    // Types générés depuis l'OpenAPI PMS + script de génération (hors périmètre lint).
    "src/types/generated/**",
    "openapi-ts.config.ts",
  ]),
  // Règle « aucune valeur en dur » (design-system, UX-DR-1.11) — code applicatif
  // uniquement. Les primitives vendored `ui/**` sont exclues (source des tokens,
  // maintenues par shadcn).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    plugins: {
      "design-tokens": {
        rules: { "no-hardcoded-values": noHardcodedDesignValues },
      },
    },
    rules: {
      "design-tokens/no-hardcoded-values": "error",
    },
  },
]);

export default eslintConfig;
