import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * ESLint 9 flat config. Con eslint-config-next >= 15 i preset sono già flat:
 * FlatCompat (approccio legacy) va in errore di validazione (config circolari)
 * con ESLint 9.39 — si importano direttamente come array di config.
 */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  {
    // Runner di build eseguiti da node PRIMA della transpilazione: i require()
    // sono l'idioma del CJS puro, la regola TS non si applica.
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
