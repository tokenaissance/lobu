import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const gatewayDir = resolve(import.meta.dir, "..");
const css = execSync(
  "bunx tailwindcss@3 -c tailwind.config.js -i src/routes/public/settings-input.css --minify",
  { cwd: gatewayDir, encoding: "utf-8" }
).trim();

// Escape for embedding in a JS template literal:
// - backslashes (e.g. Tailwind's `.w-3\.5` selector) must be doubled
// - backticks and ${ must be escaped
const escaped = css
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

const output = `/**
 * Auto-generated Tailwind CSS for the settings page.
 * DO NOT EDIT — regenerated on every build/dev start.
 */
export const settingsPageCSS = \`
${escaped}
[x-cloak] { display: none !important; }\`;
`;

writeFileSync(
  resolve(gatewayDir, "src/routes/public/settings-page-styles.ts"),
  output
);
console.log("Settings CSS generated");
