import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "build/**", "dist/**", ".local/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
