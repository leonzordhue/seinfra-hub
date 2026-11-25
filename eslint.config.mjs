// Lint mínimo da v2 (roda no deploy.yml antes de publicar). [Claude] 25/11/2026
// Só pega o que derruba a tela em produção: nome indefinido (ex.: "R is not defined" no mapa da
// Acessibilidade em 25/11), import inexistente, chave duplicada, código inalcançável. Estilo não é cobrado.
import globals from "globals";

export default [
  {
    files: ["v2/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, L: "readonly", Chart: "readonly", pmtiles: "readonly", protomapsL: "readonly", maplibregl: "readonly" },
    },
    rules: {
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-redeclare": "error",
      "no-const-assign": "error",
      "no-import-assign": "error",
    },
  },
];
