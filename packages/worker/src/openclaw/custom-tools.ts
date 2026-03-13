import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { Static } from "@sinclair/typebox";
import { type TSchema, Type } from "@sinclair/typebox";
import type { GatewayParams, TextResult } from "../shared/tool-implementations";
import {
  askUserQuestion,
  callService,
  cancelReminder,
  configure,
  connectService,
  disconnectService,
  generateAudio,
  generateImage,
  getChannelHistory,
  installPackage,
  installSkill,
  listReminders,
  requestNetworkAccess,
  scheduleReminder,
  searchSkills,
  uploadUserFile,
} from "../shared/tool-implementations";

type ToolResult = AgentToolResult<Record<string, unknown>>;

/** Adapt shared TextResult to OpenClaw's ToolResult (adds details field) */
function toToolResult(result: TextResult): ToolResult {
  return { content: result.content, details: {} };
}

/**
 * Create a ToolDefinition with proper type bridging between TypeBox schemas
 * and the shared tool implementation functions. Eliminates per-tool `as` casts
 * by casting once at the boundary.
 */
function defineTool<T extends TSchema>(config: {
  name: string;
  description: string;
  parameters: T;
  run: (args: Static<T>) => Promise<TextResult>;
}): ToolDefinition {
  return {
    name: config.name,
    label: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: async (_toolCallId, args) =>
      toToolResult(await config.run(args as Static<T>)),
  };
}

export function createOpenClawCustomTools(params: {
  gatewayUrl: string;
  workerToken: string;
  channelId: string;
  conversationId: string;
  platform?: string;
}): ToolDefinition[] {
  const gw: GatewayParams = {
    gatewayUrl: params.gatewayUrl,
    workerToken: params.workerToken,
    channelId: params.channelId,
    conversationId: params.conversationId,
    platform: params.platform || "slack",
  };

  const tools: ToolDefinition[] = [
    defineTool({
      name: "UploadUserFile",
      description:
        "Use this whenever you create a visualization, chart, image, document, report, or any file that helps answer the user's request. This is how you share your work with the user.",
      parameters: Type.Object({
        file_path: Type.String({
          description:
            "Path to the file to show (absolute or relative to workspace)",
        }),
        description: Type.Optional(
          Type.String({
            description:
              "Optional description of what the file contains or shows",
          })
        ),
      }),
      run: (args) => uploadUserFile(gw, args),
    }),

    defineTool({
      name: "ScheduleReminder",
      description:
        "Schedule a task for yourself to execute later. Use delayMinutes for one-time reminders, or cron for recurring schedules. The reminder will be delivered as a message in this thread.",
      parameters: Type.Object({
        task: Type.String({
          description: "Description of what you need to do when reminded",
        }),
        delayMinutes: Type.Optional(
          Type.Number({
            description:
              "Minutes from now to trigger (1-1440, max 24 hours). Use this OR cron, not both.",
          })
        ),
        cron: Type.Optional(
          Type.String({
            description:
              "Cron expression for recurring schedule (e.g., '*/30 * * * *' for every 30 min). Use this OR delayMinutes, not both.",
          })
        ),
        maxIterations: Type.Optional(
          Type.Number({
            description:
              "Maximum iterations for recurring schedules (default: 10, max: 100). Only used with cron.",
          })
        ),
      }),
      run: (args) => scheduleReminder(gw, args),
    }),

    defineTool({
      name: "CancelReminder",
      description:
        "Cancel a previously scheduled reminder. Use the scheduleId returned from ScheduleReminder.",
      parameters: Type.Object({
        scheduleId: Type.String({
          description: "The schedule ID returned from ScheduleReminder",
        }),
      }),
      run: (args) => cancelReminder(gw, args),
    }),

    defineTool({
      name: "ListReminders",
      description:
        "List all pending reminders you have scheduled. Shows upcoming reminders with their schedule IDs and remaining time.",
      parameters: Type.Object({}),
      run: () => listReminders(gw),
    }),

    defineTool({
      name: "SearchSkills",
      description:
        "Search for installable skills and MCP servers, or list installed capabilities. Pass a query to search registries. Pass an empty query to list all installed skills, integrations, and MCP servers.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "What to search for (e.g., 'pdf', 'gmail', 'code review'). Empty string lists installed capabilities.",
        }),
        limit: Type.Optional(
          Type.Number({
            description: "Maximum results to return (default 5, max 10)",
          })
        ),
      }),
      run: (args) => searchSkills(gw, args),
    }),

    defineTool({
      name: "InstallSkill",
      description:
        "Install or upgrade a skill from SearchSkills (pass id), or define an inline skill with its provider/MCP dependencies (pass reason + config). Skills bundle capabilities — use ConnectService to connect individual providers or MCPs.",
      parameters: Type.Object({
        id: Type.Optional(
          Type.String({
            description:
              "Skill or MCP server ID from SearchSkills results (for install/upgrade flow)",
          })
        ),
        upgrade: Type.Optional(
          Type.Boolean({
            description:
              "Set to true to upgrade an already-installed skill to the latest version",
          })
        ),
        reason: Type.Optional(
          Type.String({
            description:
              "Brief explanation of what the user should approve/configure (required when id is not provided)",
          })
        ),
        message: Type.Optional(
          Type.String({
            description:
              "Optional message to display on the settings page with instructions",
          })
        ),
        providers: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "Provider IDs this skill depends on (e.g., 'openai', 'claude')",
          })
        ),
        skills: Type.Optional(
          Type.Array(
            Type.Object({
              repo: Type.String({
                description: "Skill repository (e.g., 'anthropics/skills/pdf')",
              }),
              name: Type.Optional(
                Type.String({ description: "Display name for the skill" })
              ),
              description: Type.Optional(
                Type.String({
                  description: "Brief description of what the skill does",
                })
              ),
            }),
            { description: "Inline skill definitions to add in settings" }
          )
        ),
        mcpServers: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String({
                description: "Unique identifier for the MCP server",
              }),
              name: Type.Optional(
                Type.String({
                  description: "Display name for the MCP server",
                })
              ),
              url: Type.Optional(
                Type.String({ description: "Server URL for SSE-type MCPs" })
              ),
              type: Type.Optional(
                Type.Union([Type.Literal("sse"), Type.Literal("stdio")], {
                  description: "Server type",
                })
              ),
              command: Type.Optional(
                Type.String({
                  description: "Command to run for stdio-type MCPs",
                })
              ),
              args: Type.Optional(
                Type.Array(Type.String(), {
                  description: "Arguments for stdio-type MCPs",
                })
              ),
            }),
            { description: "MCP servers this skill depends on" }
          )
        ),
      }),
      run: (args) => {
        const id = args.id?.trim();
        if (id) {
          return installSkill(gw, { id, upgrade: args.upgrade });
        }
        if (!args.reason?.trim()) {
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: "Error: InstallSkill requires either an id (to install/upgrade from registry) or a reason (for inline skill setup).",
              },
            ],
          });
        }
        return configure(gw, {
          reason: args.reason!,
          message: args.message,
          providers: args.providers,
          skills: args.skills,
          mcpServers: args.mcpServers,
        });
      },
    }),

    defineTool({
      name: "InstallPackage",
      description:
        "Request installation of system packages (nix). Sends approval buttons to the user. Stop and wait for approval after calling.",
      parameters: Type.Object({
        packages: Type.Array(Type.String(), {
          description:
            "Nix package names to install (e.g., 'ffmpeg', 'imagemagick')",
        }),
        reason: Type.String({
          description: "Brief explanation of why these packages are needed",
        }),
      }),
      run: (args) => installPackage(gw, args),
    }),

    defineTool({
      name: "RequestNetworkAccess",
      description:
        "Request access to blocked domains. Sends inline approval buttons to the user. Stop and wait for approval after calling. Do NOT retry blocked requests — the domain is blocked at the network level.",
      parameters: Type.Object({
        domains: Type.Array(Type.String(), {
          description:
            "Domain patterns to request access for (e.g., 'api.example.com')",
        }),
        reason: Type.String({
          description: "Brief explanation of why access is needed",
        }),
      }),
      run: (args) => requestNetworkAccess(gw, args),
    }),

    defineTool({
      name: "GenerateImage",
      description:
        "Generate an image from a text prompt and send it to the user. Use when the user asks for image generation, visual concepts, posters, illustrations, or edits that can be done from prompt instructions.",
      parameters: Type.Object({
        prompt: Type.String({
          description: "The image prompt to generate",
        }),
        size: Type.Optional(
          Type.Union(
            [
              Type.Literal("1024x1024"),
              Type.Literal("1024x1536"),
              Type.Literal("1536x1024"),
              Type.Literal("auto"),
            ],
            {
              description: "Output image size (default: 1024x1024)",
            }
          )
        ),
        quality: Type.Optional(
          Type.Union(
            [
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high"),
              Type.Literal("auto"),
            ],
            {
              description: "Image quality (default: auto)",
            }
          )
        ),
        background: Type.Optional(
          Type.Union(
            [
              Type.Literal("transparent"),
              Type.Literal("opaque"),
              Type.Literal("auto"),
            ],
            {
              description: "Background style (default: auto)",
            }
          )
        ),
        format: Type.Optional(
          Type.Union(
            [Type.Literal("png"), Type.Literal("jpeg"), Type.Literal("webp")],
            {
              description: "Output image format (default: png)",
            }
          )
        ),
      }),
      run: (args) => generateImage(gw, args),
    }),

    defineTool({
      name: "GenerateAudio",
      description:
        "Generate audio from text (text-to-speech). Use when you want to respond with a voice message, read content aloud, or when the user asks for audio output.",
      parameters: Type.Object({
        text: Type.String({
          description: "The text to convert to speech (max 4096 characters)",
        }),
        voice: Type.Optional(
          Type.String({
            description:
              "Voice ID (provider-specific). OpenAI: alloy, echo, fable, onyx, nova, shimmer. Leave empty for default.",
          })
        ),
        speed: Type.Optional(
          Type.Number({
            description: "Speech speed (0.5-2.0, default 1.0).",
          })
        ),
      }),
      run: (args) => generateAudio(gw, args),
    }),

    defineTool({
      name: "GetChannelHistory",
      description:
        "Fetch previous messages from this conversation thread. Use when the user references past discussions, asks 'what did we talk about', or you need context.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({
            description: "Number of messages to fetch (default 50, max 100)",
          })
        ),
        before: Type.Optional(
          Type.String({
            description:
              "ISO timestamp cursor - fetch messages before this time (for pagination)",
          })
        ),
      }),
      run: (args) => getChannelHistory(gw, args),
    }),

    defineTool({
      name: "AskUserQuestion",
      description:
        "Posts a question with button options to the user. Session ends after posting. The user's response will arrive as a new message in the next session.",
      parameters: Type.Object({
        question: Type.String({
          description: "The question to ask the user",
        }),
        options: Type.Array(Type.String(), {
          description: "Array of button labels for the user to choose from",
        }),
      }),
      run: (args) => askUserQuestion(gw, args),
    }),

    defineTool({
      name: "ConnectService",
      description:
        "Connect a service: OAuth integration, MCP server, or AI provider (e.g., 'claude', 'gemini'). Sends a setup button to the user. Use this whenever the user asks to connect or configure any service, including AI providers.",
      parameters: Type.Object({
        id: Type.String({
          description:
            "Service ID — integration ID (e.g., 'google'), MCP server ID (e.g., 'owletto'), or provider ID (e.g., 'claude', 'gemini', 'chatgpt')",
        }),
        scopes: Type.Optional(
          Type.Array(Type.String(), {
            description:
              "Specific OAuth scopes to request. If omitted, uses defaults from the integration config and installed skills.",
          })
        ),
        reason: Type.Optional(
          Type.String({
            description:
              "Brief reason for the connection request, shown to the user.",
          })
        ),
        account: Type.Optional(
          Type.String({
            description:
              "Label for the account, e.g. 'work' or 'personal'. Omit for default account.",
          })
        ),
      }),
      run: (args) => connectService(gw, args),
    }),

    defineTool({
      name: "CallService",
      description:
        "Make an authenticated API call through a connected service. The gateway injects the OAuth token — you never see credentials. Supports any REST API within the service's allowed domains.",
      parameters: Type.Object({
        integration: Type.String({
          description: "Service/integration ID (e.g., 'google')",
        }),
        method: Type.String({
          description: "HTTP method (GET, POST, PUT, DELETE, PATCH)",
        }),
        url: Type.String({
          description:
            "Full URL to call (must be within the service's allowed domains)",
        }),
        headers: Type.Optional(
          Type.Record(Type.String(), Type.String(), {
            description:
              "Additional HTTP headers (Authorization is injected automatically)",
          })
        ),
        body: Type.Optional(
          Type.String({
            description: "Request body (for POST/PUT/PATCH)",
          })
        ),
        account: Type.Optional(
          Type.String({
            description: "Which account to use. Omit for default.",
          })
        ),
      }),
      run: (args) => callService(gw, args),
    }),

    defineTool({
      name: "DisconnectService",
      description:
        "Disconnect from a third-party service. Removes stored credentials.",
      parameters: Type.Object({
        integration: Type.String({
          description: "Service/integration ID to disconnect (e.g., 'google')",
        }),
        account: Type.Optional(
          Type.String({
            description: "Which account to disconnect. Omit for default.",
          })
        ),
      }),
      run: (args) => disconnectService(gw, args),
    }),
  ];

  return tools;
}
