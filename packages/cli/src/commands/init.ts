import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
  getRequiredEnvVars,
  MCP_SERVERS,
  type McpServerDefinition,
} from "../mcp-servers.js";
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
          name: "Embedded (in-process, no Docker needed for workers)",
          value: "embedded",
        },
        {
          name: "Docker containers (sandboxed workers, recommended for teams)",
          value: "docker",
        },
      ],
      default: "embedded",
    },
  ]);

  // MCP Server selection
  const { configureMcp } = await inquirer.prompt([
    {
      type: "confirm",
      name: "configureMcp",
      message: "Would you like to configure MCP servers?",
      default: true,
    },
  ]);

  let selectedMcpServers: McpServerDefinition[] = [];
  let publicUrl = "";

  if (configureMcp) {
    const { mcpServers } = await inquirer.prompt([
      {
        type: "checkbox",
        name: "mcpServers",
        message: "Select MCP servers to configure (you can add more later):",
        choices: [
          ...MCP_SERVERS.map((server) => ({
            name: `${server.name} - ${server.description}`,
            value: server.id,
            checked: server.id === "github", // GitHub selected by default
          })),
          {
            name: "Custom MCP server (provide URL)",
            value: "custom",
          },
        ],
        pageSize: 15,
      },
    ]);

    selectedMcpServers = MCP_SERVERS.filter((s) => mcpServers.includes(s.id));

    // Handle custom MCP server
    if (mcpServers.includes("custom")) {
      const { customMcpUrl, customMcpName } = await inquirer.prompt([
        {
          type: "input",
          name: "customMcpName",
          message: "Custom MCP server name:",
          validate: (input: string) => {
            if (!input || !/^[a-z0-9-]+$/.test(input)) {
              return "Name must be lowercase alphanumeric with hyphens only";
            }
            return true;
          },
        },
        {
          type: "input",
          name: "customMcpUrl",
          message: "Custom MCP server URL:",
          validate: (input: string) => {
            if (!input) {
              return "Please enter a valid URL";
            }
            try {
              new URL(input);
              return true;
            } catch {
              return "Please enter a valid URL (e.g., https://your-mcp-server.com)";
            }
          },
        },
      ]);

      selectedMcpServers.push({
        id: customMcpName,
        name: customMcpName,
        description: "Custom MCP server",
        type: "none",
        config: {
          url: customMcpUrl,
        },
      });
    }

    // Check if any OAuth servers were selected
    const hasOAuthServers = selectedMcpServers.some((s) => s.type === "oauth");

    if (hasOAuthServers) {
      const { publicGatewayUrl } = await inquirer.prompt([
        {
          type: "input",
          name: "publicGatewayUrl",
          message: "Public Gateway URL (required for OAuth MCP servers):",
          default: "http://localhost:8080",
          validate: (input: string) => {
            if (!input) {
              return "Public URL is required when using OAuth-based MCP servers";
            }
            try {
              new URL(input);
              return true;
            } catch {
              return "Please enter a valid URL (e.g., https://your-domain.com)";
            }
          },
        },
      ]);
      publicUrl = publicGatewayUrl;
    }
  }

  // Platform selection
  const { selectedPlatforms } = await inquirer.prompt([
    {
      type: "checkbox",
      name: "selectedPlatforms",
      message:
        "Which messaging platform(s) do you want to configure? (REST API is always available)",
      choices: [
        {
          name: "Telegram (quickest — 1 token from @BotFather)",
          value: "telegram",
        },
        {
          name: "Slack (requires app creation + 3 credentials)",
          value: "slack",
        },
        {
          name: "Discord (requires bot token + application ID)",
          value: "discord",
        },
        {
          name: "WhatsApp (requires Cloud API access token)",
          value: "whatsapp",
        },
        {
          name: "Teams (requires Microsoft App registration)",
          value: "teams",
        },
      ],
    },
  ]);

  // Platform credentials are configured via the settings page after setup
  if (selectedPlatforms.length > 0) {
    console.log(
      chalk.dim(
        `\nℹ Platform credentials (${selectedPlatforms.join(", ")}) are configured via the settings page after startup.\n`
      )
    );
  }

  const { aiKeyStrategy } = await inquirer.prompt([
    {
      type: "list",
      name: "aiKeyStrategy",
      message: "How should teammates access Claude/OpenAI?",
      choices: [
        {
          name: "Each user brings their subscriptions",
          value: "user-provided",
        },
        {
          name: "Provide shared keys now so the bot works out of the box",
          value: "shared",
        },
      ],
      default: "user-provided",
    },
  ]);

  let anthropicApiKey = "";
  if (aiKeyStrategy === "shared") {
    const { sharedAnthropicApiKey } = await inquirer.prompt([
      {
        type: "password",
        name: "sharedAnthropicApiKey",
        message: "Shared Anthropic (Claude) API Key (sk-ant-...)?",
      },
    ]);
    anthropicApiKey = sharedAnthropicApiKey;
  }
  if (anthropicApiKey === "") {
    const authHint = selectedPlatforms.includes("slack")
      ? "teammates authorize Claude/OpenAI from the Slack Home tab on first use"
      : "users authorize Claude/OpenAI on first use";
    console.log(chalk.dim(`\nℹ With no shared API key, ${authHint}.\n`));
  }

  // Worker network access configuration
  const { networkAccessMode } = await inquirer.prompt([
    {
      type: "list",
      name: "networkAccessMode",
      message: "Configure worker internet access:",
      choices: [
        {
          name: "🔒 Filtered access (recommended) - Allow only specific domains",
          value: "filtered",
        },
        {
          name: "🚫 Complete isolation - No internet access",
          value: "isolated",
        },
        {
          name: "🌐 Unrestricted access - Full internet (not recommended)",
          value: "unrestricted",
        },
      ],
      default: "filtered",
    },
  ]);

  let allowedDomains = "";
  let disallowedDomains = "";

  const defaultDomains = [
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

  if (networkAccessMode === "filtered") {
    const { customizeDomains } = await inquirer.prompt([
      {
        type: "confirm",
        name: "customizeDomains",
        message:
          "Use default allowed domains? (Claude API, npm, GitHub, PyPI, CDNs)",
        default: true,
      },
    ]);

    if (!customizeDomains) {
      const { allowedDomainsInput } = await inquirer.prompt([
        {
          type: "input",
          name: "allowedDomainsInput",
          message: "Enter comma-separated allowed domains:",
          default: defaultDomains,
          validate: (input: string) => {
            if (!input || input.trim().length === 0) {
              return "At least one domain is required for filtered mode";
            }
            return true;
          },
        },
      ]);
      allowedDomains = allowedDomainsInput;
    } else {
      allowedDomains = defaultDomains;
    }

    const { addDisallowedDomains } = await inquirer.prompt([
      {
        type: "confirm",
        name: "addDisallowedDomains",
        message:
          "Add disallowed domains? (Optional - blocks specific domains within allowed patterns)",
        default: false,
      },
    ]);

    if (addDisallowedDomains) {
      const { disallowedDomainsInput } = await inquirer.prompt([
        {
          type: "input",
          name: "disallowedDomainsInput",
          message: "Enter comma-separated disallowed domains:",
        },
      ]);
      disallowedDomains = disallowedDomainsInput;
    }
  } else if (networkAccessMode === "unrestricted") {
    allowedDomains = "*";

    const { addDisallowedDomains } = await inquirer.prompt([
      {
        type: "confirm",
        name: "addDisallowedDomains",
        message: "Block any specific domains? (Optional)",
        default: false,
      },
    ]);

    if (addDisallowedDomains) {
      const { disallowedDomainsInput } = await inquirer.prompt([
        {
          type: "input",
          name: "disallowedDomainsInput",
          message: "Enter comma-separated domains to block:",
        },
      ]);
      disallowedDomains = disallowedDomainsInput;
    }
  }
  // else isolated mode: leave both empty

  // Generate encryption key for credentials
  const encryptionKey = randomBytes(32).toString("hex");

  const answers = {
    ...baseAnswers,
    deploymentMode: deploymentMode as "embedded" | "docker",
    anthropicApiKey,
    publicUrl,
    encryptionKey,
    selectedMcpServers,
    selectedPlatforms,
    allowedDomains,
    disallowedDomains,
  };

  // docker-compose.yml will be created in new directory, no need to check
  const composeFilename = "docker-compose.yml";

  const spinner = ora("Creating Lobu project...").start();

  try {
    // Create .lobu directory in project directory
    const lobuDir = join(projectDir, ".lobu");
    await mkdir(lobuDir, { recursive: true });

    // Generate MCP config if servers were selected
    if (answers.selectedMcpServers.length > 0) {
      const mcpConfig: { mcpServers: Record<string, any> } = {
        mcpServers: {},
      };

      for (const server of answers.selectedMcpServers) {
        // Clone the config and replace PUBLIC_URL placeholder
        const serverConfig = JSON.parse(
          JSON.stringify(server.config)
            .replace(
              /\{PUBLIC_URL\}/g,
              answers.publicUrl || "http://localhost:8080"
            )
            .replace(/\$\{([A-Z_]+)\}/g, (match, varName) => {
              // Keep env: prefix for secrets, remove for client IDs
              if (match.includes("env:")) {
                return match;
              }
              return `\${${varName}}`; // Will be replaced with instructions
            })
        );

        mcpConfig.mcpServers[server.id] = serverConfig;
      }

      await writeFile(
        join(lobuDir, "mcp.config.json"),
        JSON.stringify(mcpConfig, null, 2)
      );
    }

    // Generate lobu.toml
    await generateLobuToml(projectDir, {
      agentName: projectName,
      platforms: answers.selectedPlatforms,
      mcpServers: answers.selectedMcpServers,
      allowedDomains: answers.allowedDomains,
    });

    const variables = {
      PROJECT_NAME: projectName,
      CLI_VERSION: cliVersion,
      DEPLOYMENT_MODE: answers.deploymentMode,
      ENCRYPTION_KEY: answers.encryptionKey,
      ANTHROPIC_API_KEY: answers.anthropicApiKey || "",
      PUBLIC_GATEWAY_URL: answers.publicUrl || "http://localhost:8080",
      GATEWAY_PORT: "8080",
      WORKER_ALLOWED_DOMAINS: answers.allowedDomains,
      WORKER_DISALLOWED_DOMAINS: answers.disallowedDomains,
    };

    // Create .env file
    await renderTemplate(".env.tmpl", variables, join(projectDir, ".env"));

    // Append MCP environment variables if any were selected
    if (answers.selectedMcpServers.length > 0) {
      const requiredEnvVars = getRequiredEnvVars(answers.selectedMcpServers);
      if (requiredEnvVars.length > 0) {
        let mcpEnvContent = "\n# MCP Server Credentials\n";
        mcpEnvContent +=
          "# Add your OAuth client secrets and API keys below:\n";

        for (const varName of requiredEnvVars) {
          mcpEnvContent += `${varName}=your_${varName.toLowerCase()}_here\n`;
        }

        const envPath = join(projectDir, ".env");
        const currentContent = await readFile(envPath, "utf-8");
        await writeFile(envPath, currentContent + mcpEnvContent);
      }
    }

    // Create .gitignore
    await renderTemplate(".gitignore.tmpl", {}, join(projectDir, ".gitignore"));

    // Create README
    await renderTemplate(
      "README.md.tmpl",
      variables,
      join(projectDir, "README.md")
    );

    // Create agent instruction files
    await writeFile(
      join(projectDir, "IDENTITY.md"),
      `# Identity\n\nYou are ${projectName}, a helpful AI assistant.\n`
    );
    await writeFile(
      join(projectDir, "SOUL.md"),
      `# Instructions\n\nBe concise and helpful. Ask clarifying questions when the request is ambiguous.\n`
    );
    await writeFile(
      join(projectDir, "USER.md"),
      `# User Context\n\n<!-- Add user-specific preferences, timezone, environment details here -->\n`
    );

    // Create skills directory for custom skills
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
      gatewayPort: "8080",
      dockerfilePath: "./Dockerfile.worker",
      hasMcpServers: answers.selectedMcpServers.length > 0,
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
      chalk.dim("     - lobu.toml          (providers, skills, network)")
    );
    console.log(chalk.dim("     - IDENTITY.md        (who the agent is)"));
    console.log(chalk.dim("     - SOUL.md            (behavior rules)"));
    console.log(chalk.dim("     - USER.md            (user-specific context)"));
    console.log(
      chalk.dim("     - skills/            (custom skills — auto-discovered)")
    );
    console.log(chalk.dim("     - .env               (secrets)"));
    console.log(chalk.dim(`     - ${composeFilename}`));
    if (answers.deploymentMode === "docker") {
      console.log(chalk.dim("     - Dockerfile.worker"));
    }
    if (answers.selectedMcpServers.length > 0) {
      console.log(chalk.dim("     - .lobu/mcp.config.json"));
    }
    console.log();

    // MCP Setup instructions
    let nextStep = 3;
    if (answers.selectedMcpServers.length > 0) {
      const oauthServers = answers.selectedMcpServers.filter(
        (s: McpServerDefinition) => s.type === "oauth"
      );
      const apiKeyServers = answers.selectedMcpServers.filter(
        (s: McpServerDefinition) => s.type === "api-key"
      );

      if (oauthServers.length > 0 || apiKeyServers.length > 0) {
        console.log(chalk.cyan(`  ${nextStep}. Configure MCP servers:`));
        nextStep++;

        if (oauthServers.length > 0) {
          console.log(chalk.yellow("\n     OAuth-based MCP servers:"));
          for (const server of oauthServers) {
            console.log(chalk.dim(`     - ${server.name}:`));
            const instructions = server.setupInstructions
              ?.replace(
                /\{PUBLIC_URL\}/g,
                answers.publicUrl || "http://localhost:8080"
              )
              .split("\n")
              .filter((line: string) => line.trim())
              .map((line: string) => `       ${line}`)
              .join("\n");
            if (instructions) {
              console.log(chalk.dim(instructions));
            }
          }
        }

        if (apiKeyServers.length > 0) {
          console.log(chalk.yellow("\n     API Key-based MCP servers:"));
          for (const server of apiKeyServers) {
            console.log(
              chalk.dim(`     - ${server.name}: Add API key to .env file`)
            );
          }
        }

        console.log();
      }
    }

    console.log(chalk.cyan(`  ${nextStep}. Start the services:`));
    console.log(chalk.dim(`     docker compose -f ${composeFilename} up -d\n`));
    nextStep++;
    console.log(chalk.cyan(`  ${nextStep}. View logs:`));
    console.log(
      chalk.dim(`     docker compose -f ${composeFilename} logs -f\n`)
    );
    nextStep++;
    console.log(chalk.cyan(`  ${nextStep}. Stop the services:`));
    console.log(chalk.dim(`     docker compose -f ${composeFilename} down\n`));
    nextStep++;
  } catch (error) {
    spinner.fail("Failed to create project");
    throw error;
  }
}

async function generateLobuToml(
  projectDir: string,
  options: {
    agentName: string;
    platforms: string[];
    mcpServers: McpServerDefinition[];
    allowedDomains: string;
  }
): Promise<void> {
  const lines: string[] = [
    "# lobu.toml — Agent configuration",
    "# Docs: https://lobu.ai/docs/getting-started",
    "#",
    "# Agent identity lives in markdown files:",
    "#   IDENTITY.md  — Who the agent is",
    "#   SOUL.md      — Behavior rules & instructions",
    "#   USER.md      — User-specific context",
    "#   skills/*.md  — Custom capabilities (auto-discovered)",
    "",
    "[agent]",
    `name = "${options.agentName}"`,
    `description = ""`,
    "",
    "# LLM providers (order = priority)",
    "[[providers]]",
    'id = "groq"',
    'model = "llama-3.3-70b-versatile"',
    "",
    "# Skills from the registry",
    "[skills]",
    'enabled = ["github"]',
  ];

  // Custom MCP servers
  const customMcps = options.mcpServers.filter(
    (s) => s.type === "none" || s.type === "command"
  );
  if (customMcps.length > 0) {
    lines.push("");
    for (const mcp of customMcps) {
      if (mcp.config?.url) {
        lines.push(`[skills.mcp.${mcp.id}]`);
        lines.push(`url = "${mcp.config.url}"`);
      }
    }
  }

  // Network
  if (options.allowedDomains) {
    const domains = options.allowedDomains
      .split(",")
      .map((d) => `"${d.trim()}"`)
      .join(", ");
    lines.push("", "[network]", `allowed = [${domains}]`);
  }

  // Platforms — declare which connections to enable
  for (const platform of options.platforms) {
    lines.push("", `[platforms.${platform}]`);
    if (platform === "telegram") {
      lines.push('mode = "auto"');
    }
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
  hasMcpServers: boolean;
  deploymentMode: "embedded" | "docker";
}): string {
  const { projectName, gatewayPort, hasMcpServers, deploymentMode } = options;
  const gatewayImage = `ghcr.io/lobu-ai/lobu-gateway:latest`;
  const workerImage = `ghcr.io/lobu-ai/lobu-worker-base:latest`;

  const mcpConfigMount = hasMcpServers
    ? `
      - ./.lobu/mcp.config.json:/app/.lobu/mcp.config.json:ro`
    : "";

  const mcpEnvVars = hasMcpServers
    ? `
      MCP_CONFIG_URL: file:///app/.lobu/mcp.config.json
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}`
    : "";

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
      - "8118:8118" # HTTP proxy for workers`
      : "";

  return `# Generated by @lobu/cli
# Deployment mode: ${deploymentMode}

name: ${projectName}

services:
  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save 60 1 --dir /data
    volumes:
      - redis_data:/data
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
    ports:
      - "${gatewayPort}:8080"${proxyPort}
    environment:
      DEPLOYMENT_MODE: ${deploymentMode}${workerImageEnv}
      QUEUE_URL: redis://redis:6379/0
      PUBLIC_GATEWAY_URL: \${PUBLIC_GATEWAY_URL:-}
      NODE_ENV: production
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      COMPOSE_PROJECT_NAME: ${projectName}${mcpEnvVars}
      WORKER_ALLOWED_DOMAINS: \${WORKER_ALLOWED_DOMAINS:-}
      WORKER_DISALLOWED_DOMAINS: \${WORKER_DISALLOWED_DOMAINS:-}
    volumes:${dockerSocketMount}${mcpConfigMount}
      - env_storage:/app/.lobu/env
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

volumes:
  redis_data:
  env_storage:
`;
}
