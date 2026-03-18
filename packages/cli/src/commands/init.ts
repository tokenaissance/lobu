import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
  isIntegrationSkill,
  isProviderSkill,
  loadSkillsRegistry,
  type RegistrySkill,
} from "../commands/skills/registry.js";
import { secretsSetCommand } from "../commands/secrets.js";
import { renderTemplate } from "../utils/template.js";

export async function initCommand(
  cwd: string = process.cwd(),
  projectNameArg?: string
): Promise<void> {
  console.log(chalk.bold.cyan("\n🤖 Welcome to Lobu!\n"));

  // Get CLI version
  const cliVersion = await getCliVersion();

  // Validate project name if provided as argument
  if (projectNameArg && !/^[a-z0-9-]+$/.test(projectNameArg)) {
    console.log(
      chalk.red(
        "\n✗ Project name must be lowercase alphanumeric with hyphens only\n"
      )
    );
    process.exit(1);
  }

  // Interactive prompts - basic setup
  const baseAnswers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name?",
      default: projectNameArg || "my-lobu",
      validate: (input: string) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return "Project name must be lowercase alphanumeric with hyphens only";
        }
        return true;
      },
      when: !projectNameArg, // Skip prompt if project name provided as argument
    },
  ]);

  // Use project name from argument or prompt
  const projectName = projectNameArg || baseAnswers.projectName;
  const projectDir = join(cwd, projectName);
  try {
    await access(projectDir, constants.F_OK);
    console.log(
      chalk.red(
        `\n✗ Directory "${projectName}" already exists. Please choose a different project name or remove the existing directory.\n`
      )
    );
    process.exit(1);
  } catch {
    // Directory doesn't exist - good to proceed
    await mkdir(projectDir, { recursive: true });
    console.log(
      chalk.dim(`\nCreating project in: ${chalk.cyan(projectDir)}\n`)
    );
  }

  // Deployment mode selection
  const { deploymentMode } = await inquirer.prompt([
    {
      type: "list",
      name: "deploymentMode",
      message: "How should workers run?",
      choices: [
        {
          name: "Embedded — virtual bash & filesystem, no package installs, lower resource usage",
          value: "embedded",
        },
        {
          name: "Docker — isolated containers per user, full OS access, heavier but more capable",
          value: "docker",
        },
      ],
      default: "embedded",
    },
  ]);

  // Gateway port selection
  const { gatewayPort } = await inquirer.prompt([
    {
      type: "input",
      name: "gatewayPort",
      message: "Gateway port?",
      default: "8080",
      validate: (input: string) => {
        const port = Number(input);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return "Please enter a valid port number (1-65535)";
        }
        return true;
      },
    },
  ]);

  // Public gateway URL (optional — only needed for OAuth callbacks and external webhooks)
  const { publicGatewayUrl } = await inquirer.prompt([
    {
      type: "input",
      name: "publicGatewayUrl",
      message:
        "Public gateway URL? (leave empty for local dev, set for OAuth/webhooks)",
      default: "",
    },
  ]);

  // Admin password
  const { adminPassword } = await inquirer.prompt([
    {
      type: "password",
      name: "adminPassword",
      message: "Admin password?",
      mask: "*",
      validate: (input: string) => {
        if (!input || input.length < 4) {
          return "Password must be at least 4 characters";
        }
        return true;
      },
    },
  ]);

  // Worker network access policy
  const { networkPolicy } = await inquirer.prompt([
    {
      type: "list",
      name: "networkPolicy",
      message: "Worker network access?",
      choices: [
        {
          name: "Restricted (recommended) — common registries only (npm, GitHub, PyPI)",
          value: "restricted",
        },
        {
          name: "Open — workers can access any domain",
          value: "open",
        },
        {
          name: "Isolated — workers have no internet access",
          value: "isolated",
        },
      ],
      default: "restricted",
    },
  ]);

  // Provider selection (from system-skills.json registry)
  const providerSkills = loadSkillsRegistry().filter(isProviderSkill);
  const providerChoices = [
    { name: "Skip — I'll add a provider later", value: "" },
    ...providerSkills.map((s) => ({
      name: `${s.providers![0]!.displayName}${s.providers![0]!.defaultModel ? ` (${s.providers![0]!.defaultModel})` : ""}`,
      value: s.id,
    })),
  ];

  const { providerId } = await inquirer.prompt([
    {
      type: "list",
      name: "providerId",
      message: "AI provider?",
      choices: providerChoices,
      default: "",
    },
  ]);

  let providerApiKey = "";
  let selectedProvider: RegistrySkill | undefined;
  if (providerId) {
    selectedProvider = providerSkills.find((s) => s.id === providerId);
    const p = selectedProvider?.providers?.[0];
    if (p) {
      const { apiKey } = await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: `${p.displayName} API key:`,
          mask: "*",
        },
      ]);
      providerApiKey = apiKey || "";
    }
  }

  // Skills selection (integration skills from registry, excluding provider-only skills)
  const integrationSkills = loadSkillsRegistry().filter(
    (s) => isIntegrationSkill(s) && !isProviderSkill(s) && !s.hidden
  );
  const { skillIds } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "skillIds",
      message: "Enable integration skills?",
      choices: integrationSkills.map((s) => ({
        name: `${s.name} — ${s.description}`,
        value: s.id,
        checked: s.id === "github",
      })),
      when: integrationSkills.length > 0,
    },
  ]);
  const selectedSkillIds: string[] = skillIds || [];

  // Connection (messaging platform) selection
  const platformChoices = [
    { name: "Skip — I'll connect a platform later", value: "" },
    { name: "Telegram", value: "telegram" },
    { name: "Slack", value: "slack" },
    { name: "Discord", value: "discord" },
  ];

  const { platformType } = await inquirer.prompt([
    {
      type: "list",
      name: "platformType",
      message: "Connect a messaging platform?",
      choices: platformChoices,
      default: "",
    },
  ]);

  const connectionConfig: Record<string, string> = {};
  const connectionSecrets: Array<{ envVar: string; value: string }> = [];

  if (platformType === "telegram") {
    const { botToken } = await inquirer.prompt([
      {
        type: "password",
        name: "botToken",
        message: "Telegram bot token (from @BotFather):",
        mask: "*",
      },
    ]);
    if (botToken) {
      connectionConfig.botToken = "$TELEGRAM_BOT_TOKEN";
      connectionSecrets.push({
        envVar: "TELEGRAM_BOT_TOKEN",
        value: botToken,
      });
    }
  } else if (platformType === "slack") {
    const slackAnswers = await inquirer.prompt([
      {
        type: "password",
        name: "botToken",
        message: "Slack bot token (xoxb-...):",
        mask: "*",
      },
      {
        type: "password",
        name: "signingSecret",
        message: "Slack signing secret:",
        mask: "*",
      },
    ]);
    if (slackAnswers.botToken) {
      connectionConfig.botToken = "$SLACK_BOT_TOKEN";
      connectionSecrets.push({
        envVar: "SLACK_BOT_TOKEN",
        value: slackAnswers.botToken,
      });
    }
    if (slackAnswers.signingSecret) {
      connectionConfig.signingSecret = "$SLACK_SIGNING_SECRET";
      connectionSecrets.push({
        envVar: "SLACK_SIGNING_SECRET",
        value: slackAnswers.signingSecret,
      });
    }
  } else if (platformType === "discord") {
    const { botToken } = await inquirer.prompt([
      {
        type: "password",
        name: "botToken",
        message: "Discord bot token:",
        mask: "*",
      },
    ]);
    if (botToken) {
      connectionConfig.botToken = "$DISCORD_BOT_TOKEN";
      connectionSecrets.push({
        envVar: "DISCORD_BOT_TOKEN",
        value: botToken,
      });
    }
  }

  // Settings page OAuth login (optional)
  const { oauthIssuer } = await inquirer.prompt([
    {
      type: "input",
      name: "oauthIssuer",
      message: "Settings page OAuth issuer URL (leave empty to skip):",
      default: "",
    },
  ]);

  const oauthSecrets: Array<{ envVar: string; value: string }> = [];
  if (oauthIssuer) {
    const oauthAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "clientId",
        message: "OAuth client ID (leave empty for dynamic registration):",
        default: "",
      },
      {
        type: "password",
        name: "clientSecret",
        message: "OAuth client secret (leave empty if public client):",
        mask: "*",
        default: "",
      },
    ]);

    oauthSecrets.push({
      envVar: "SETTINGS_OAUTH_ISSUER_URL",
      value: oauthIssuer,
    });
    if (oauthAnswers.clientId) {
      oauthSecrets.push({
        envVar: "SETTINGS_OAUTH_CLIENT_ID",
        value: oauthAnswers.clientId,
      });
    }
    if (oauthAnswers.clientSecret) {
      oauthSecrets.push({
        envVar: "SETTINGS_OAUTH_CLIENT_SECRET",
        value: oauthAnswers.clientSecret,
      });
    }
  }

  // Compute network domains from selected policy
  let allowedDomains: string;
  let disallowedDomains: string;
  if (networkPolicy === "open") {
    allowedDomains = "*";
    disallowedDomains = "";
  } else if (networkPolicy === "isolated") {
    allowedDomains = "";
    disallowedDomains = "";
  } else {
    // restricted (default)
    allowedDomains = [
      "registry.npmjs.org",
      ".npmjs.org",
      "github.com",
      ".github.com",
      ".githubusercontent.com",
      "cdn.jsdelivr.net",
      "unpkg.com",
      "pypi.org",
      "files.pythonhosted.org",
    ].join(",");
    disallowedDomains = "";
  }
  const encryptionKey = randomBytes(32).toString("hex");

  const answers = {
    ...baseAnswers,
    deploymentMode: deploymentMode as "embedded" | "docker",
    encryptionKey,
    allowedDomains,
    disallowedDomains,
  };

  // docker-compose.yml will be created in new directory, no need to check
  const composeFilename = "docker-compose.yml";

  const spinner = ora("Creating Lobu project...").start();

  try {
    // Create .lobu and data directories in project directory
    await mkdir(join(projectDir, ".lobu"), { recursive: true });
    await mkdir(join(projectDir, "data"), { recursive: true });

    // Generate lobu.toml
    await generateLobuToml(projectDir, {
      agentName: projectName,
      allowedDomains: answers.allowedDomains,
      providerId: providerId || undefined,
      providerEnvVar: selectedProvider?.providers?.[0]?.envVarName,
      providerModel: selectedProvider?.providers?.[0]?.defaultModel,
      connectionType: platformType || undefined,
      connectionConfig:
        Object.keys(connectionConfig).length > 0 ? connectionConfig : undefined,
      skillIds: selectedSkillIds,
    });

    const variables = {
      PROJECT_NAME: projectName,
      CLI_VERSION: cliVersion,
      DEPLOYMENT_MODE: answers.deploymentMode,
      ADMIN_PASSWORD: adminPassword,
      ENCRYPTION_KEY: answers.encryptionKey,
      GATEWAY_PORT: gatewayPort,
      WORKER_ALLOWED_DOMAINS: answers.allowedDomains,
      WORKER_DISALLOWED_DOMAINS: answers.disallowedDomains,
    };

    // Create .env file
    await renderTemplate(".env.tmpl", variables, join(projectDir, ".env"));

    // Save public gateway URL if explicitly set
    if (publicGatewayUrl) {
      await secretsSetCommand(
        projectDir,
        "PUBLIC_GATEWAY_URL",
        publicGatewayUrl
      );
    }

    // Save provider API key to .env
    if (providerApiKey && selectedProvider?.providers?.[0]?.envVarName) {
      await secretsSetCommand(
        projectDir,
        selectedProvider.providers[0].envVarName,
        providerApiKey
      );
    }

    // Save connection secrets to .env
    for (const secret of connectionSecrets) {
      await secretsSetCommand(projectDir, secret.envVar, secret.value);
    }

    // Save OAuth secrets to .env
    for (const secret of oauthSecrets) {
      await secretsSetCommand(projectDir, secret.envVar, secret.value);
    }

    // Create .gitignore
    await renderTemplate(".gitignore.tmpl", {}, join(projectDir, ".gitignore"));

    // Create README
    await renderTemplate(
      "README.md.tmpl",
      variables,
      join(projectDir, "README.md")
    );

    // Create agent directory with instruction files
    const agentDir = join(projectDir, "agents", projectName);
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "IDENTITY.md"),
      `# Identity\n\nYou are ${projectName}, a helpful AI assistant.\n`
    );
    await writeFile(
      join(agentDir, "SOUL.md"),
      `# Instructions\n\nBe concise and helpful. Ask clarifying questions when the request is ambiguous.\n`
    );
    await writeFile(
      join(agentDir, "USER.md"),
      `# User Context\n\n<!-- Add user-specific preferences, timezone, environment details here -->\n`
    );

    // Create agent-specific skills directory
    await mkdir(join(agentDir, "skills"), { recursive: true });
    await writeFile(join(agentDir, "skills", ".gitkeep"), "");

    // Create shared skills directory
    await mkdir(join(projectDir, "skills"), { recursive: true });
    await writeFile(join(projectDir, "skills", ".gitkeep"), "");

    // Create AGENTS.md
    await renderTemplate(
      "AGENTS.md.tmpl",
      variables,
      join(projectDir, "AGENTS.md")
    );

    // Create TESTING.md
    await renderTemplate(
      "TESTING.md.tmpl",
      variables,
      join(projectDir, "TESTING.md")
    );

    if (answers.deploymentMode === "docker") {
      // Create Dockerfile.worker for docker mode
      await renderTemplate(
        "Dockerfile.worker.tmpl",
        variables,
        join(projectDir, "Dockerfile.worker")
      );
    }

    // Always generate docker-compose.yml (Redis is needed for all modes)
    const composeContent = generateDockerCompose({
      projectName,
      gatewayPort,
      dockerfilePath: "./Dockerfile.worker",
      deploymentMode: answers.deploymentMode,
    });
    await writeFile(join(projectDir, composeFilename), composeContent);

    spinner.succeed("Project created successfully!");

    // Print next steps
    console.log(chalk.green("\n✓ Lobu initialized!\n"));
    console.log(chalk.bold("Next steps:\n"));
    console.log(chalk.cyan("  1. Navigate to your project:"));
    console.log(chalk.dim(`     cd ${projectName}\n`));
    console.log(chalk.cyan("  2. Review your configuration:"));
    console.log(
      chalk.dim(
        "     - lobu.toml                    (agents, providers, skills, network)"
      )
    );
    console.log(
      chalk.dim(
        `     - agents/${projectName}/   (IDENTITY.md, SOUL.md, USER.md, skills/)`
      )
    );
    console.log(
      chalk.dim(
        "     - skills/                      (shared skills — all agents)"
      )
    );
    console.log(chalk.dim("     - .env                         (secrets)"));
    console.log(chalk.dim(`     - ${composeFilename}`));
    if (answers.deploymentMode === "docker") {
      console.log(chalk.dim("     - Dockerfile.worker"));
    }
    console.log();

    const gatewayUrl = `http://localhost:${gatewayPort}`;
    console.log(chalk.cyan("  3. Start the services:"));
    console.log(chalk.dim("     lobu dev -d\n"));
    console.log(chalk.cyan("  4. Open the admin page:"));
    console.log(chalk.dim(`     ${gatewayUrl}/agents\n`));
    console.log(chalk.cyan("  5. View logs:"));
    console.log(chalk.dim("     docker compose logs -f\n"));
    console.log(chalk.cyan("  6. Stop the services:"));
    console.log(chalk.dim("     docker compose down\n"));
  } catch (error) {
    spinner.fail("Failed to create project");
    throw error;
  }
}

async function generateLobuToml(
  projectDir: string,
  options: {
    agentName: string;
    allowedDomains: string;
    providerId?: string;
    providerEnvVar?: string;
    providerModel?: string;
    connectionType?: string;
    connectionConfig?: Record<string, string>;
    skillIds?: string[];
  }
): Promise<void> {
  const id = options.agentName;
  const lines: string[] = [
    "# lobu.toml — Agent configuration",
    "# Docs: https://lobu.ai/docs/getting-started",
    "#",
    "# Each [agents.{id}] defines an agent. The dir field points to a directory",
    "# containing IDENTITY.md, SOUL.md, USER.md, and optionally skills/.",
    "# Shared skills in the root skills/ directory are available to all agents.",
    "",
    `[agents.${id}]`,
    `name = "${id}"`,
    `description = ""`,
    `dir = "./agents/${id}"`,
    "",
    "# LLM providers (order = priority, key = API key or $ENV_VAR)",
  ];

  if (options.providerId && options.providerEnvVar) {
    lines.push(
      `[[agents.${id}.providers]]`,
      `id = "${options.providerId}"`,
      ...(options.providerModel ? [`model = "${options.providerModel}"`] : []),
      `key = "$${options.providerEnvVar}"`
    );
  } else {
    lines.push(
      "# Add providers via the admin page or uncomment below:",
      `# [[agents.${id}.providers]]`,
      '# id = "anthropic"',
      '# key = "$ANTHROPIC_API_KEY"'
    );
  }

  lines.push("");

  if (options.connectionType && options.connectionConfig) {
    lines.push(
      `[[agents.${id}.connections]]`,
      `type = "${options.connectionType}"`
    );
    lines.push(`[agents.${id}.connections.config]`);
    for (const [key, value] of Object.entries(options.connectionConfig)) {
      lines.push(`${key} = "${value}"`);
    }
  } else {
    lines.push(
      "# Messaging platform (add via admin page or uncomment below):",
      `# [[agents.${id}.connections]]`,
      '# type = "telegram"',
      `# [agents.${id}.connections.config]`,
      '# botToken = "$TELEGRAM_BOT_TOKEN"'
    );
  }

  lines.push(
    "",
    "# Skills from the registry",
    `[agents.${id}.skills]`,
    `enabled = [${(options.skillIds ?? []).map((s) => `"${s}"`).join(", ")}]`,
    "",
    "# MCP servers (add custom tool servers with optional OAuth):",
    `# [agents.${id}.skills.mcp.my-mcp]`,
    '# url = "https://my-mcp.example.com"',
    `# [agents.${id}.skills.mcp.my-mcp.oauth]`,
    '# auth_url = "https://auth.example.com/authorize"',
    '# token_url = "https://auth.example.com/token"',
    '# client_id = "$MY_MCP_CLIENT_ID"'
  );

  // Network
  lines.push("", `[agents.${id}.network]`);
  if (options.allowedDomains) {
    const domains = options.allowedDomains
      .split(",")
      .map((d) => `"${d.trim()}"`)
      .join(", ");
    lines.push(`allowed = [${domains}]`);
  } else {
    lines.push("allowed = []");
  }

  lines.push(""); // trailing newline
  await writeFile(join(projectDir, "lobu.toml"), lines.join("\n"));
}

async function getCliVersion(): Promise<string> {
  const pkgPath = new URL("../../package.json", import.meta.url);
  const pkgContent = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(pkgContent);
  return pkg.version || "0.1.0";
}

function generateDockerCompose(options: {
  projectName: string;
  gatewayPort: string;
  dockerfilePath: string;
  deploymentMode: "embedded" | "docker";
}): string {
  const { projectName, gatewayPort, deploymentMode } = options;
  const gatewayImage = `ghcr.io/lobu-ai/lobu-gateway:latest`;
  const workerImage = `ghcr.io/lobu-ai/lobu-worker-base:latest`;

  const dockerSocketMount =
    deploymentMode === "docker"
      ? `
      - /var/run/docker.sock:/var/run/docker.sock`
      : "";

  const workerImageEnv =
    deploymentMode === "docker"
      ? `
      WORKER_IMAGE: ${workerImage}`
      : "";

  const proxyPort =
    deploymentMode === "docker"
      ? `
      - "127.0.0.1:8118:8118" # HTTP proxy for workers`
      : "";

  return `# Generated by @lobu/cli
# Deployment mode: ${deploymentMode}

name: ${projectName}

services:
  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy noeviction --save 60 1 --dir /data
    working_dir: /tmp
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - lobu-internal
    restart: unless-stopped

  gateway:
    image: ${gatewayImage}
    pull_policy: always
    ports:
      - "127.0.0.1:\${GATEWAY_PORT:-${gatewayPort}}:8080"${proxyPort}
    environment:
      DEPLOYMENT_MODE: ${deploymentMode}${workerImageEnv}
      QUEUE_URL: redis://redis:6379/0
      PUBLIC_GATEWAY_URL: \${PUBLIC_GATEWAY_URL:-}
      GATEWAY_PORT: \${GATEWAY_PORT:-${gatewayPort}}
      NODE_ENV: production
      COMPOSE_PROJECT_NAME: ${projectName}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      WORKER_ALLOWED_DOMAINS: \${WORKER_ALLOWED_DOMAINS:-}
      WORKER_DISALLOWED_DOMAINS: \${WORKER_DISALLOWED_DOMAINS:-}
      SETTINGS_OAUTH_ISSUER_URL: \${SETTINGS_OAUTH_ISSUER_URL:-}
      SETTINGS_OAUTH_CLIENT_ID: \${SETTINGS_OAUTH_CLIENT_ID:-}
      SETTINGS_OAUTH_CLIENT_SECRET: \${SETTINGS_OAUTH_CLIENT_SECRET:-}
    volumes:${dockerSocketMount}
      - ./.lobu:/app/.lobu
    networks:
      - lobu-public
      - lobu-internal
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

networks:
  lobu-public:
    driver: bridge
  lobu-internal:
    internal: true
    driver: bridge

`;
}
