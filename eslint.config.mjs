import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".wrangler/**", "node_modules/**", "worker-configuration.d.ts"],
  },
  ...tseslint.configs.recommended,
);
