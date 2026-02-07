import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: ["figma-make-prototype/", "app/generated/"],
  },
];

export default eslintConfig;
