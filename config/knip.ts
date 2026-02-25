import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "packages/*/src/**/*.{ts,tsx,js,jsx,cjs,mjs}",
    "packages/*/bin/**/*.{js,cjs,mjs}",
  ],
  ignore: [
    "**/dist/**",
    "charts/**",
    "integration-tests/**",
    "examples/**",
    "config/dependency-cruiser.config.cjs",
    "workspaces/**",
    "my-app/**",
    "docker/docker-compose*.yml",
    "scripts/**",
  ],
  ignoreBinaries: ["helm"],
};

export default config;
