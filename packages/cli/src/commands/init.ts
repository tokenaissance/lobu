import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import YAML from "yaml";
import { checkConfigExists } from "../utils/config.js";
import { renderTemplate } from "../utils/template.js";
import {
  MCP_SERVERS,
  getRequiredEnvVars,
  type McpServerDefinition,
} from "../mcp-servers.js";

const DEFAULT_SLACK_MANIFEST = {
  display_information: {
    name: "Peerbot",
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
      display_name: "Peerbot",
      always_online: true,
    },
    slash_commands: [
      {
        command: "/peerbot",
        description:
          "Peerbot commands - manage repositories and authentication",
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

export async function initCommand(cwd: string = process.cwd()): Promise<void> {
  console.log(chalk.bold.cyan("\n🤖 Welcome to Peerbot!\n"));

  // Check if already initialized
  const configExists = await checkConfigExists(cwd);
  if (configExists) {
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Peerbot config already exists. Overwrite?",
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log(chalk.yellow("\nℹ Initialization cancelled\n"));
      return;
    }
  }

  // Get CLI version
  const cliVersion = await getCliVersion();

  // Interactive prompts - basic setup
  const baseAnswers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name?",
      default: "my-peerbot",
      validate: (input: string) => {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return "Project name must be lowercase alphanumeric with hyphens only";
        }
        return true;
      },
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
        choices: MCP_SERVERS.map((server) => ({
          name: `${server.name} - ${server.description}`,
          value: server.id,
          checked: server.id === "github", // GitHub selected by default
        })),
        pageSize: 15,
      },
    ]);

    selectedMcpServers = MCP_SERVERS.filter((s) => mcpServers.includes(s.id));

    // Check if any OAuth servers were selected
    const hasOAuthServers = selectedMcpServers.some((s) => s.type === "oauth");

    if (hasOAuthServers) {
      const { publicGatewayUrl } = await inquirer.prompt([
        {
          type: "input",
          name: "publicGatewayUrl",
          message: "Public Gateway URL (required for OAuth MCP servers):",
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
          name: "Create a new Slack app using the Peerbot manifest",
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
  };

  // Check if docker-compose.yml exists
  let composeFilename = "docker-compose.yml";
  try {
    await access(join(cwd, composeFilename), constants.F_OK);
    const { customFilename } = await inquirer.prompt([
      {
        type: "input",
        name: "customFilename",
        message: `${composeFilename} already exists. Enter a different filename:`,
        default: "docker-compose.peerbot.yml",
        validate: (input: string) => {
          if (!input.endsWith(".yml") && !input.endsWith(".yaml")) {
            return "Filename must end with .yml or .yaml";
          }
          return true;
        },
      },
    ]);
    composeFilename = customFilename;
  } catch {
    // File doesn't exist, use default
  }

  const spinner = ora("Creating Peerbot project...").start();

  try {
    const workerMode = answers.workerMode;
    const projectName = answers.projectName;

    // Create .peerbot directory
    const peerbotDir = join(cwd, ".peerbot");
    await mkdir(peerbotDir, { recursive: true });

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
        join(peerbotDir, "mcp.config.json"),
        JSON.stringify(mcpConfig, null, 2)
      );
    }

    const variables = {
      PROJECT_NAME: projectName,
      CLI_VERSION: cliVersion,
      SLACK_SIGNING_SECRET: answers.slackSigningSecret,
      SLACK_BOT_TOKEN: answers.slackBotToken,
      SLACK_APP_TOKEN: answers.slackAppToken,
      ANTHROPIC_API_KEY: answers.anthropicApiKey,
      ENCRYPTION_KEY: answers.encryptionKey,
      PEERBOT_PUBLIC_GATEWAY_URL: answers.publicUrl || "",
      GATEWAY_PORT: "8080",
    };

    // Create .env file
    await renderTemplate(".env.tmpl", variables, join(cwd, ".env"));

    // Append MCP environment variables if any were selected
    if (answers.selectedMcpServers.length > 0) {
      const requiredEnvVars = getRequiredEnvVars(answers.selectedMcpServers);
      if (requiredEnvVars.length > 0) {
        let mcpEnvContent = "\n# MCP Server Credentials\n";
        mcpEnvContent +=
          "# Add your OAuth client secrets and API keys below:\n";

        for (const varName of requiredEnvVars) {
          mcpEnvContent += `# ${varName}=your_${varName.toLowerCase()}_here\n`;
        }

        const envPath = join(cwd, ".env");
        const currentContent = await readFile(envPath, "utf-8");
        await writeFile(envPath, currentContent + mcpEnvContent);
      }
    }

    // Create .gitignore
    await renderTemplate(".gitignore.tmpl", {}, join(cwd, ".gitignore"));

    // Create README
    await renderTemplate("README.md.tmpl", variables, join(cwd, "README.md"));

    // Create Dockerfile.worker based on mode
    if (workerMode === "base-image") {
      await renderTemplate(
        "Dockerfile.worker.tmpl",
        variables,
        join(cwd, "Dockerfile.worker")
      );
    } else if (workerMode === "package") {
      await renderTemplate(
        "Dockerfile.worker-package.tmpl",
        variables,
        join(cwd, "Dockerfile.worker")
      );
    }

    // Generate docker-compose.yml
    const composeContent = generateDockerCompose({
      projectName,
      cliVersion,
      gatewayPort: "8080",
      dockerfilePath: "./Dockerfile.worker",
      hasMcpServers: answers.selectedMcpServers.length > 0,
    });
    await writeFile(join(cwd, composeFilename), composeContent);

    spinner.succeed("Project created successfully!");

    // Print next steps
    console.log(chalk.green("\n✓ Peerbot initialized!\n"));
    console.log(chalk.bold("Next steps:\n"));
    console.log(chalk.cyan("  1. Review your configuration:"));
    console.log(chalk.dim("     - .env"));
    console.log(chalk.dim(`     - ${composeFilename}`));
    console.log(chalk.dim("     - Dockerfile.worker"));
    if (answers.selectedMcpServers.length > 0) {
      console.log(chalk.dim("     - .peerbot/mcp.config.json"));
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
        console.log(chalk.cyan("  2. Configure MCP servers:"));

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

        console.log(chalk.cyan("\n  3. Start the services:"));
      } else {
        console.log(chalk.cyan("  2. Start the services:"));
      }
    } else {
      console.log(chalk.cyan("  2. Start the services:"));
    }

    console.log(chalk.dim(`     docker compose -f ${composeFilename} up -d\n`));
    console.log(
      chalk.cyan(
        `  ${answers.selectedMcpServers.length > 0 ? "4" : "3"}. View logs:`
      )
    );
    console.log(
      chalk.dim(`     docker compose -f ${composeFilename} logs -f\n`)
    );
    console.log(
      chalk.cyan(
        `  ${answers.selectedMcpServers.length > 0 ? "5" : "4"}. Stop the services:`
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
  cliVersion: string;
  gatewayPort: string;
  dockerfilePath: string;
  hasMcpServers: boolean;
}): string {
  const {
    projectName,
    cliVersion,
    gatewayPort,
    dockerfilePath,
    hasMcpServers,
  } = options;
  const workerImage = `${projectName}-worker:latest`;
  const gatewayImage = `buremba/peerbot-gateway:${cliVersion}`;

  const mcpEnvVars = hasMcpServers
    ? `
      MCP_CONFIG_URL: file:///app/.peerbot/mcp.config.json
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}`
    : "";

  const mcpVolumes = hasMcpServers
    ? `
      - ./.peerbot:/app/.peerbot:ro`
    : "";

  return `# Generated by @peerbot/cli
# You can modify this file as needed

name: ${projectName}

services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - redis_data:/data
    networks:
      - ${projectName}-network

  gateway:
    image: ${gatewayImage}
    ports:
      - "${gatewayPort}:8080"
    environment:
      DEPLOYMENT_MODE: docker
      WORKER_IMAGE: ${workerImage}
      REDIS_URL: redis://redis:6379
      QUEUE_URL: redis://redis:6379/0
      SLACK_BOT_TOKEN: \${SLACK_BOT_TOKEN}
      SLACK_APP_TOKEN: \${SLACK_APP_TOKEN}
      SLACK_SIGNING_SECRET: \${SLACK_SIGNING_SECRET}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY}
      PEERBOT_PUBLIC_GATEWAY_URL: \${PEERBOT_PUBLIC_GATEWAY_URL:-}
      HOST_PROJECT_PATH: \${PWD}
      NODE_ENV: \${NODE_ENV:-development}${mcpEnvVars}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./workspaces:/app/workspaces
      - env_storage:/app/.peerbot/env${mcpVolumes}
    networks:
      - ${projectName}-network
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  worker:
    build:
      context: .
      dockerfile: ${dockerfilePath}
      args:
        BASE_VERSION: ${cliVersion}
        NODE_ENV: \${NODE_ENV:-development}
    image: ${workerImage}
    command: echo "Worker image built successfully"
    profiles:
      - build-only

networks:
  ${projectName}-network:
    driver: bridge

volumes:
  redis_data:
  env_storage:
`;
}
