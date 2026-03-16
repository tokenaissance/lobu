import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
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

  // Worker network access — always filtered, configurable per-agent later
  const allowedDomains = [
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
  const disallowedDomains = "";

  // Generate encryption key for credentials
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
    // Create .lobu directory in project directory
    await mkdir(join(projectDir, ".lobu"), { recursive: true });

    // Generate lobu.toml
    await generateLobuToml(projectDir, {
      agentName: projectName,
      allowedDomains: answers.allowedDomains,
    });

    const variables = {
      PROJECT_NAME: projectName,
      CLI_VERSION: cliVersion,
      DEPLOYMENT_MODE: answers.deploymentMode,
      ENCRYPTION_KEY: answers.encryptionKey,
      PUBLIC_GATEWAY_URL: `http://localhost:${gatewayPort}`,
      GATEWAY_PORT: gatewayPort,
      WORKER_ALLOWED_DOMAINS: answers.allowedDomains,
      WORKER_DISALLOWED_DOMAINS: answers.disallowedDomains,
    };

    // Create .env file
    await renderTemplate(".env.tmpl", variables, join(projectDir, ".env"));

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
    "# LLM providers (order = priority)",
    `[[agents.${id}.providers]]`,
    'id = "groq"',
    'model = "llama-3.3-70b-versatile"',
    "",
    "# Skills from the registry",
    `[agents.${id}.skills]`,
    'enabled = ["github"]',
  ];

  // Network
  if (options.allowedDomains) {
    const domains = options.allowedDomains
      .split(",")
      .map((d) => `"${d.trim()}"`)
      .join(", ");
    lines.push("", `[agents.${id}.network]`, `allowed = [${domains}]`);
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
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru --save 60 1 --dir /data
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
      NODE_ENV: production
      COMPOSE_PROJECT_NAME: ${projectName}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      WORKER_ALLOWED_DOMAINS: \${WORKER_ALLOWED_DOMAINS:-}
      WORKER_DISALLOWED_DOMAINS: \${WORKER_DISALLOWED_DOMAINS:-}
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
