import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import { parse as parseToml } from "smol-toml";
import { CONFIG_FILENAME } from "../../config/loader.js";
import { secretsSetCommand } from "../secrets.js";
import { PLATFORM_LABELS, promptPlatformConfig } from "./platforms.js";

const SUPPORTED = [
  "telegram",
  "slack",
  "discord",
  "whatsapp",
  "teams",
  "gchat",
];

export async function connectionsAddCommand(
  cwd: string,
  platform: string
): Promise<void> {
  if (!SUPPORTED.includes(platform)) {
    console.log(chalk.red(`\n  Platform "${platform}" is not supported.`));
    console.log(chalk.dim(`  Supported: ${SUPPORTED.join(", ")}\n`));
    return;
  }

  const configPath = join(cwd, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    console.log(
      chalk.red(`\n  No ${CONFIG_FILENAME} found. Run \`lobu init\` first.\n`)
    );
    return;
  }

  const parsed = parseToml(raw) as Record<string, unknown>;
  const agents = parsed.agents as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!agents || Object.keys(agents).length === 0) {
    console.log(chalk.red("\n  No agents found in lobu.toml.\n"));
    return;
  }

  const agentId = Object.keys(agents)[0]!;
  const agent = agents[agentId]!;
  const existing = (agent.connections ?? []) as Array<Record<string, unknown>>;

  if (existing.some((c) => c.type === platform)) {
    console.log(
      chalk.yellow(
        `\n  Connection "${platform}" is already configured for agent "${agentId}".\n`
      )
    );
    return;
  }

  console.log(
    chalk.dim(
      `\n  Adding ${PLATFORM_LABELS[platform]} connection to agent "${agentId}".\n`
    )
  );

  const { connectionConfig, connectionSecrets } =
    await promptPlatformConfig(platform);

  if (Object.keys(connectionConfig).length === 0) {
    console.log(chalk.yellow("\n  No credentials provided. Aborting.\n"));
    return;
  }

  // Append connection block to the TOML file (preserves comments/formatting)
  const lines = [
    "",
    `[[agents.${agentId}.connections]]`,
    `type = "${platform}"`,
    "",
    `[agents.${agentId}.connections.config]`,
  ];
  for (const [key, value] of Object.entries(connectionConfig)) {
    lines.push(`${key} = "${value}"`);
  }

  await writeFile(configPath, `${raw.trimEnd()}\n${lines.join("\n")}\n`);

  // Save credentials to .env
  for (const secret of connectionSecrets) {
    await secretsSetCommand(cwd, secret.envVar, secret.value);
  }

  console.log(
    chalk.green(
      `\n  Added ${PLATFORM_LABELS[platform]} connection to ${CONFIG_FILENAME}`
    )
  );
  console.log(
    chalk.dim(
      `  Run \`lobu run -d\` to start the stack with the new connection.\n`
    )
  );
}
