import chalk from "chalk";
import {
  appendTomlBlock,
  loadAgentContext,
  setSecrets,
} from "../../config/agent-helpers.js";
import { CONFIG_FILENAME } from "../../config/loader.js";
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

  const ctx = await loadAgentContext(cwd);
  if (!ctx) return;

  const existing = (ctx.agent.connections ?? []) as Array<
    Record<string, unknown>
  >;
  if (existing.some((c) => c.type === platform)) {
    console.log(
      chalk.yellow(
        `\n  Connection "${platform}" is already configured for agent "${ctx.agentId}".\n`
      )
    );
    return;
  }

  console.log(
    chalk.dim(
      `\n  Adding ${PLATFORM_LABELS[platform]} connection to agent "${ctx.agentId}".\n`
    )
  );

  const { connectionConfig, connectionSecrets } =
    await promptPlatformConfig(platform);

  if (Object.keys(connectionConfig).length === 0) {
    console.log(chalk.yellow("\n  No credentials provided. Aborting.\n"));
    return;
  }

  const lines = [
    "",
    `[[agents.${ctx.agentId}.connections]]`,
    `type = "${platform}"`,
    "",
    `[agents.${ctx.agentId}.connections.config]`,
    ...Object.entries(connectionConfig).map(
      ([key, value]) => `${key} = "${value}"`
    ),
  ];
  await appendTomlBlock(ctx, lines);
  await setSecrets(cwd, connectionSecrets);

  console.log(
    chalk.green(
      `\n  Added ${PLATFORM_LABELS[platform]} connection to ${CONFIG_FILENAME}`
    )
  );
  console.log(
    chalk.dim(
      "  Run `lobu run -d` to start the stack with the new connection.\n"
    )
  );
}
