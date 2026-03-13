import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const gatewayDir = resolve(import.meta.dir, "..");

async function main() {
  const result = await build({
    entryPoints: [resolve(gatewayDir, "src/routes/public/admin-page/app.tsx")],
    bundle: true,
    minify: true,
    format: "esm",
    target: ["es2020"],
    write: false,
    jsx: "automatic",
    jsxImportSource: "preact",
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  });

  const js = result.outputFiles?.[0]?.text || "";

  // Also write raw JS for fs.readFileSync usage (avoids bun require cache)
  writeFileSync(
    resolve(gatewayDir, "src/routes/public/admin-page-bundle.raw.js"),
    js
  );
  console.log("Admin page JS bundle generated");
}

main().catch((err) => {
  console.error("Failed to build admin page:", err);
  process.exit(1);
});
