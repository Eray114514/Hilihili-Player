import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**"]
  },
  {
    files: ["**/*.ts", "**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
