import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "services/jimwood-cms/types/generated/**",
      "services/jimwood-cms/src/admin/*.example.*",
    ],
  },
];

export default eslintConfig;
