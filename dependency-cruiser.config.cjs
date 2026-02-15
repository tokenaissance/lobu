/**
 * Dependency-cruiser configuration to keep our workspace boundaries honest.
 * See https://github.com/sverweij/dependency-cruiser for details.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  extends: ["dependency-cruiser/configs/recommended-warn-only"],
  forbidden: [
    {
      name: "core-must-stay-isolated",
      comment:
        "Core is the shared foundation; it must not depend on package-specific code.",
      severity: "error",
      from: {
        path: "^packages/core/src",
      },
      to: {
        path: "^packages/(gateway|worker|github)/src",
      },
    },
    {
      name: "worker-must-not-know-platforms",
      comment:
        "Worker stays platform-agnostic and should only rely on @lobu/core.",
      severity: "error",
      from: {
        path: "^packages/worker/src",
      },
      to: {
        path: "^packages/(gateway|github)/src",
      },
    },
    {
      name: "gateway-must-not-import-worker",
      comment:
        "Gateway keeps platform adapters separate; shared logic lives in @lobu/core.",
      severity: "error",
      from: {
        path: "^packages/gateway/src",
      },
      to: {
        path: "^packages/worker/src",
      },
    },
  ],
  options: {
    tsConfig: {
      fileName: "./tsconfig.json",
    },
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: "node_modules|/dist/|__tests__|__mocks__|\\.(spec|test)\\.(ts|tsx)$|/docs/|integration-tests|examples|workspaces|charts|bin",
    },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"],
      conditionNames: ["import", "default"],
      exportsFields: ["exports"],
    },
  },
};
