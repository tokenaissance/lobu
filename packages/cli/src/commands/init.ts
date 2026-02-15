import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import YAML from "yaml";
import {
  getRequiredEnvVars,
  MCP_SERVERS,
  type McpServerDefinition,
} from "../mcp-servers.js";
import { renderTemplate } from "../utils/template.js";

const DEFAULT_SLACK_MANIFEST = {
  display_information: {
    name: "Lobu",
    description: "Hire AI peers to work with you, using your environments",
    background_color: "#4a154b",
    long_description:
      "This bot integrates Claude Code SDK with Slack to provide AI-powered coding assistance directly in your workspace. You can generate apps/AI peers that will appear as new handles.",
  },
  features: {
    app_home: {
      home_tab_enabled: true,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    },
    bot_user: {
      display_name: "Lobu",
      always_online: true,
    },
    slash_commands: [
      {
        command: "/lobu",
        description: "Lobu commands - manage repositories and authentication",
        usage_hint: "connect | login | help",
      },
    ],
    assistant_view: {
      assistant_description:
        "It can generate Claude Code session working on public Github data",
      suggested_prompts: [
        {
          title: "Create a project",
          message: "Create a new project",
        },
        {
          title: "Start working on a feature",
          message:
            "List me projects and let me tell you what I want to develop on which project",
        },
        {
          title: "Fix a bug",
          message:
            "List me projects and let me tell you what I want to develop on which project",
        },
        {
          title: "Ask a question to the codebase",
          message:
            "List me projects and let me tell you what I want to develop on which project",
        },
      ],
    },
  },
  oauth_config: {
    redirect_urls: [],
    scopes: {
      bot: [
        "app_mentions:read",
        "assistant:write",
        "channels:history",
        "channels:read",
        "chat:write",
        "chat:write.public",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "files:read",
        "files:write",
        "mpim:read",
        "reactions:read",
        "reactions:write",
        "users:read",
        "commands",
      ],
    },
  },
  settings: {
    event_subscriptions: {
      bot_events: [
        "app_home_opened",
        "app_mention",
        "team_join",
        "member_joined_channel",
        "message.channels",
        "message.groups",
        "message.im",
      ],
    },
    interactivity: {
      is_enabled: true,
    },
    org_deploy_enabled: false,
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
} as const;

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
    {
      type: "list",
      name: "workerMode",
      message: "How do you want to run workers?",
      choices: [
        {
          name: "Use our base image (quick start, recommended)",
          value: "base-image",
        },
        {
          name: "Install as package (advanced - bring your own base image)",
          value: "package",
        },
      ],
      default: "base-image",
    },
  ]);

  // Use project name from argument or prompt
  const projectName = projectNameArg || baseAnswers.projectName;

  // Create project directory - fail if it exists
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

  const { slackAppOption } = await inquirer.prompt([
    {
      type: "list",
      name: "slackAppOption",
      message: "Slack app setup?",
      choices: [
        {
          name: "Create a new Slack app using the Lobu manifest",
          value: "create",
        },
        {
          name: "Use an existing Slack app",
          value: "existing",
        },
      ],
      default: "create",
    },
  ]);

  if (slackAppOption === "create") {
    const manifestUrl = await getSlackManifestUrl();
    console.log(chalk.bold("\n🔗 Create your Slack app"));
    console.log(
      `Open this link to create the app with the recommended manifest:\n${chalk.cyan(
        chalk.underline(manifestUrl)
      )}\n`
    );
    await inquirer.prompt([
      {
        type: "confirm",
        name: "slackAppCreated",
        message:
          "Press enter after clicking “Create” and returning here to continue.",
        default: true,
      },
    ]);
  }

  const { slackAppId } = await inquirer.prompt([
    {
      type: "input",
      name: "slackAppId",
      message: "Slack App ID (optional)?",
      default: "",
    },
  ]);

  const trimmedAppId = slackAppId.trim();
  const appIdForLinks = trimmedAppId !== "" ? trimmedAppId : "<YOUR_APP_ID>";
  const appDashboardUrl = `https://api.slack.com/apps/${appIdForLinks}`;
  const oauthUrl = `${appDashboardUrl}/oauth`;

  console.log(chalk.bold("\n🔐 Collect your Slack credentials"));
  console.log(
    `Signing Secret & App-Level Tokens: ${chalk.cyan(
      chalk.underline(appDashboardUrl)
    )}`
  );
  console.log(
    `OAuth Tokens (Bot Token): ${chalk.cyan(chalk.underline(oauthUrl))}, you need to install the app first.\n`
  );
  if (trimmedAppId === "") {
    console.log(
      chalk.dim(
        "Replace <YOUR_APP_ID> in the links above once you locate your Slack app ID."
      )
    );
    console.log();
  }

  const credentialAnswers = await inquirer.prompt([
    {
      type: "password",
      name: "slackSigningSecret",
      message: "Slack Signing Secret?",
      validate: (input: string) => {
        if (!input) {
          return "Please enter your Slack signing secret.";
        }
        return true;
      },
    },
    {
      type: "password",
      name: "slackAppToken",
      message: "Slack App Token (xapp-...)?",
      validate: (input: string) => {
        if (!input || !input.startsWith("xapp-")) {
          return "Please enter a valid Slack app token starting with xapp-";
        }
        return true;
      },
    },
    {
      type: "password",
      name: "slackBotToken",
      message: "Slack Bot Token (xoxb-...)?",
      validate: (input: string) => {
        if (!input || !input.startsWith("xoxb-")) {
          return "Please enter a valid Slack bot token starting with xoxb-";
        }
        return true;
      },
    },
  ]);

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
    console.log(
      chalk.dim(
        "\nℹ With no shared API key, teammates authorize Claude/OpenAI from the Slack Home tab on first use.\n"
      )
    );
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
    slackAppId: trimmedAppId,
    ...credentialAnswers,
    anthropicApiKey,
    publicUrl,
    encryptionKey,
    selectedMcpServers,
    allowedDomains,
    disallowedDomains,
  };

  // docker-compose.yml will be created in new directory, no need to check
  const composeFilename = "docker-compose.yml";

  const spinner = ora("Creating Lobu project...").start();

  try {
    const workerMode = answers.workerMode;

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

    const variables = {
      PROJECT_NAME: projectName,
      CLI_VERSION: cliVersion,
      SLACK_SIGNING_SECRET: answers.slackSigningSecret,
      SLACK_BOT_TOKEN: answers.slackBotToken,
      SLACK_APP_TOKEN: answers.slackAppToken,
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

    // Create Dockerfile.worker based on mode
    if (workerMode === "base-image") {
      await renderTemplate(
        "Dockerfile.worker.tmpl",
        variables,
        join(projectDir, "Dockerfile.worker")
      );
    } else if (workerMode === "package") {
      await renderTemplate(
        "Dockerfile.worker-package.tmpl",
        variables,
        join(projectDir, "Dockerfile.worker")
      );
    }

    // Generate docker-compose.yml (always includes network isolation infrastructure)
    const composeContent = generateDockerCompose({
      projectName,
      gatewayPort: "8080",
      dockerfilePath: "./Dockerfile.worker",
      hasMcpServers: answers.selectedMcpServers.length > 0,
    });
    await writeFile(join(projectDir, composeFilename), composeContent);

    spinner.succeed("Project created successfully!");

    // Print next steps
    console.log(chalk.green("\n✓ Lobu initialized!\n"));
    console.log(chalk.bold("Next steps:\n"));
    console.log(chalk.cyan("  1. Navigate to your project:"));
    console.log(chalk.dim(`     cd ${projectName}\n`));
    console.log(chalk.cyan("  2. Review your configuration:"));
    console.log(chalk.dim("     - .env"));
    console.log(chalk.dim(`     - ${composeFilename}`));
    console.log(chalk.dim("     - Dockerfile.worker"));
    if (answers.selectedMcpServers.length > 0) {
      console.log(chalk.dim("     - .lobu/mcp.config.json"));
    }
    if (workerMode === "package") {
      console.log(
        chalk.yellow(
          "     ℹ Advanced mode: See docs/custom-base-image.md for requirements\n"
        )
      );
    } else {
      console.log();
    }

    // MCP Setup instructions
    if (answers.selectedMcpServers.length > 0) {
      const oauthServers = answers.selectedMcpServers.filter(
        (s: McpServerDefinition) => s.type === "oauth"
      );
      const apiKeyServers = answers.selectedMcpServers.filter(
        (s: McpServerDefinition) => s.type === "api-key"
      );

      if (oauthServers.length > 0 || apiKeyServers.length > 0) {
        console.log(chalk.cyan("  3. Configure MCP servers:"));

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

        console.log(chalk.cyan("\n  4. Start the services:"));
      } else {
        console.log(chalk.cyan("  3. Start the services:"));
      }
    } else {
      console.log(chalk.cyan("  3. Start the services:"));
    }

    console.log(chalk.dim(`     docker compose -f ${composeFilename} up -d\n`));
    console.log(
      chalk.cyan(
        `  ${answers.selectedMcpServers.length > 0 ? "5" : "4"}. View logs:`
      )
    );
    console.log(
      chalk.dim(`     docker compose -f ${composeFilename} logs -f\n`)
    );
    console.log(
      chalk.cyan(
        `  ${answers.selectedMcpServers.length > 0 ? "6" : "5"}. Stop the services:`
      )
    );
    console.log(chalk.dim(`     docker compose -f ${composeFilename} down\n`));
    console.log(
      chalk.yellow(
        "ℹ When you modify Dockerfile.worker or context files, rebuild the worker image:\n"
      )
    );
    console.log(
      chalk.dim(`  docker compose -f ${composeFilename} build worker\n`)
    );
    console.log(
      chalk.dim(
        "  The gateway will automatically pick up the latest worker image.\n"
      )
    );
  } catch (error) {
    spinner.fail("Failed to create project");
    throw error;
  }
}

async function getSlackManifestUrl(): Promise<string> {
  const manifestYaml = await loadSlackManifestYaml();
  const encodedManifest = encodeURIComponent(manifestYaml);
  return `https://api.slack.com/apps?new_app=1&manifest_yaml=${encodedManifest}`;
}

async function loadSlackManifestYaml(): Promise<string> {
  try {
    const manifestUrl = new URL(
      "../../../../slack-app-manifest.json",
      import.meta.url
    );
    const manifestContent = await readFile(manifestUrl, "utf-8");
    const manifest = JSON.parse(manifestContent);
    return YAML.stringify(manifest).trim();
  } catch {
    return YAML.stringify(DEFAULT_SLACK_MANIFEST).trim();
  }
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
}): string {
  const { projectName, gatewayPort, dockerfilePath, hasMcpServers } = options;
  const workerImage = `${projectName}-worker:latest`;
  const gatewayImage = `buremba/lobu-gateway:latest`;

  const mcpConfigMount = hasMcpServers
    ? `
      - ./.lobu/mcp.config.json:/app/.lobu/mcp.config.json:ro`
    : "";

  const mcpEnvVars = hasMcpServers
    ? `
      MCP_CONFIG_URL: file:///app/.lobu/mcp.config.json
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}`
    : "";

  return `# Generated by @lobu/cli
# You can modify this file as needed

name: ${projectName}

services:
  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
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
      - "${gatewayPort}:8080"
      - "8118:8118" # HTTP proxy for workers
    environment:
      DEPLOYMENT_MODE: docker
      WORKER_IMAGE: ${workerImage}
      QUEUE_URL: redis://redis:6379/0
      SLACK_BOT_TOKEN: \${SLACK_BOT_TOKEN}
      SLACK_APP_TOKEN: \${SLACK_APP_TOKEN}
      SLACK_SIGNING_SECRET: \${SLACK_SIGNING_SECRET}
      PUBLIC_GATEWAY_URL: \${PUBLIC_GATEWAY_URL:-}
      NODE_ENV: production
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      COMPOSE_PROJECT_NAME: ${projectName}${mcpEnvVars}
      # Worker network access control
      # Empty/unset: Complete isolation (deny all)
      # WORKER_ALLOWED_DOMAINS=*: Unrestricted access
      # WORKER_ALLOWED_DOMAINS=domains: Allowlist mode
      WORKER_ALLOWED_DOMAINS: \${WORKER_ALLOWED_DOMAINS:-}
      WORKER_DISALLOWED_DOMAINS: \${WORKER_DISALLOWED_DOMAINS:-}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock${mcpConfigMount}
      - env_storage:/app/.lobu/env
    networks:
      - lobu-public   # Internet access
      - lobu-internal # Internal services (redis, workers)
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: ${dockerfilePath}
    image: ${workerImage}
    command: echo "Worker image built successfully - this service only builds, does not run"
    restart: "no"

networks:
  # Public network with internet access (gateway only)
  lobu-public:
    driver: bridge

  # Internal network - no direct internet access
  # Workers use this network and can only reach internet via gateway's proxy
  lobu-internal:
    internal: true
    driver: bridge

volumes:
  redis_data:
  env_storage:
`;
}
