import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["packages/*/src/**/*.{ts,tsx,js,jsx,cjs,mjs}"],
  ignore: [
    "**/dist/**",
    "charts/**",
    "integration-tests/**",
    "examples/**",
    "dependency-cruiser.config.cjs",
    "workspaces/**",
    "my-app/**",
    "docker-compose*.yml",
  ],
  ignoreBinaries: ["bun", "ts-node", "tsx"],
};

export default config;
