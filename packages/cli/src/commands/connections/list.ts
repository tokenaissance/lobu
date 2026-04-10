import chalk from "chalk";
import { loadAgentContext } from "../../config/agent-helpers.js";
import { PLATFORM_LABELS } from "./platforms.js";

export async function connectionsListCommand(cwd: string): Promise<void> {
  const ctx = await loadAgentContext(cwd);
  if (!ctx) return;

  console.log();
  for (const [agentId, agent] of Object.entries(ctx.agents)) {
    const connections = (agent.connections ?? []) as Array<
      Record<string, unknown>
    >;
    console.log(chalk.bold(`  ${agentId}`));
    if (connections.length === 0) {
      console.log(chalk.dim("    (no connections configured)"));
    } else {
      for (const c of connections) {
        const type = c.type as string;
        const label = PLATFORM_LABELS[type] ?? type;
        console.log(
          `    ${chalk.cyan("●")} ${label} ${chalk.dim(`(${type})`)}`
        );
      }
    }
    console.log();
  }
}
