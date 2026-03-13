import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type RequiredParamGroup = {
  keys: readonly string[];
  allowEmpty?: boolean;
  label?: string;
};

const CLAUDE_PARAM_GROUPS: Record<
  "read" | "write" | "edit",
  RequiredParamGroup[]
> = {
  read: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  write: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  edit: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    {
      keys: ["oldText", "old_string"],
      label: "oldText (oldText or old_string)",
    },
    {
      keys: ["newText", "new_string"],
      label: "newText (newText or new_string)",
    },
  ],
};

function normalizeToolParams(
  params: unknown
): Record<string, unknown> | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  const record = params as Record<string, unknown>;
  const normalized = { ...record };

  if ("file_path" in normalized && !("path" in normalized)) {
    normalized.path = normalized.file_path;
    delete normalized.file_path;
  }
  if ("old_string" in normalized && !("oldText" in normalized)) {
    normalized.oldText = normalized.old_string;
    delete normalized.old_string;
  }
  if ("new_string" in normalized && !("newText" in normalized)) {
    normalized.newText = normalized.new_string;
    delete normalized.new_string;
  }
  return normalized;
}

function assertRequiredParams(
  params: Record<string, unknown>,
  groups: RequiredParamGroup[]
): void {
  for (const group of groups) {
    const hasValue = group.keys.some((key) => {
      const value = params[key];
      if (value === undefined || value === null) {
        return false;
      }
      if (
        !group.allowEmpty &&
        typeof value === "string" &&
        value.trim() === ""
      ) {
        return false;
      }
      return true;
    });
    if (!hasValue) {
      const label = group.label ?? group.keys.join(" or ");
      throw new Error(`Missing required parameter: ${label}`);
    }
  }
}

function wrapToolWithNormalization(params: {
  tool: AgentTool<any>;
  required: RequiredParamGroup[];
  schema: unknown;
}): AgentTool<any> {
  const { tool, required, schema } = params;
  return {
    ...tool,
    parameters: schema as any,
    execute: async (toolCallId, rawParams, signal, onUpdate) => {
      const normalized = normalizeToolParams(rawParams) ?? {};
      assertRequiredParams(normalized, required);
      return tool.execute(toolCallId, normalized as any, signal, onUpdate);
    },
  };
}

function buildReadSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    offset: Type.Optional(
      Type.Number({ description: "Start reading at this byte offset" })
    ),
    limit: Type.Optional(Type.Number({ description: "Maximum bytes to read" })),
  });
}

function buildWriteSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    content: Type.String({ description: "Content to write" }),
  });
}

function buildEditSchema() {
  return Type.Object({
    path: Type.Optional(Type.String({ description: "Path to the file" })),
    file_path: Type.Optional(Type.String({ description: "Path to the file" })),
    oldText: Type.Optional(Type.String({ description: "Text to replace" })),
    old_string: Type.Optional(Type.String({ description: "Text to replace" })),
    newText: Type.Optional(Type.String({ description: "Replacement text" })),
    new_string: Type.Optional(Type.String({ description: "Replacement text" })),
  });
}

export function createOpenClawTools(
  cwd: string,
  options?: { bashOperations?: BashOperations }
): AgentTool<any>[] {
  const read = wrapToolWithNormalization({
    tool: createReadTool(cwd),
    required: CLAUDE_PARAM_GROUPS.read,
    schema: buildReadSchema(),
  });

  const write = wrapToolWithNormalization({
    tool: createWriteTool(cwd),
    required: CLAUDE_PARAM_GROUPS.write,
    schema: buildWriteSchema(),
  });

  const edit = wrapToolWithNormalization({
    tool: createEditTool(cwd),
    required: CLAUDE_PARAM_GROUPS.edit,
    schema: buildEditSchema(),
  });

  const bashToolOpts = options?.bashOperations
    ? { operations: options.bashOperations }
    : undefined;
  const bash = wrapBashWithProxyHint(createBashTool(cwd, bashToolOpts));

  return [
    read,
    write,
    edit,
    bash,
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}

/**
 * Wrap bash tool to detect proxy CONNECT 403 errors and append a hint.
 * curl doesn't display the proxy response body for CONNECT failures,
 * so the model never sees "Domain not allowed" — only exit code 56.
 */
function wrapBashWithProxyHint(tool: AgentTool<any>): AgentTool<any> {
  const PROXY_403_PATTERN = /Received HTTP code 403 from proxy after CONNECT/i;
  const DIRECT_PACKAGE_INSTALL_PATTERNS: RegExp[] = [
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?apt(?:-get)?(?:\s+[-\w=]+)*\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?apk(?:\s+[-\w=]+)*\s+add\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?yum(?:\s+[-\w=]+)*\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?dnf(?:\s+[-\w=]+)*\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?pacman(?:\s+[-\w=]+)*\s+-S\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?zypper(?:\s+[-\w=]+)*\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?brew(?:\s+[-\w=]+)*\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?nix-shell\s+-p\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?nix\s+profile\s+install\b/i,
    /(?:^|[;&|\n]\s*)(?:sudo\s+)?nix-env\s+-i\b/i,
  ];

  const getCommand = (params: unknown): string => {
    if (!params || typeof params !== "object") {
      return "";
    }
    const maybe = params as Record<string, unknown>;
    const commandValue = maybe.command ?? maybe.cmd;
    return typeof commandValue === "string" ? commandValue : "";
  };

  const isDirectPackageInstall = (command: string): boolean =>
    DIRECT_PACKAGE_INSTALL_PATTERNS.some((pattern) => pattern.test(command));

  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const command = getCommand(params);
      if (command && isDirectPackageInstall(command)) {
        throw new Error(
          "DIRECT PACKAGE INSTALL BLOCKED. Do not run apt/brew/nix install commands directly. Use the InstallPackage tool (for example: packages=['ffmpeg'], reason='Install ffmpeg') so the user can approve the change."
        );
      }

      try {
        return await tool.execute(toolCallId, params, signal, onUpdate);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (PROXY_403_PATTERN.test(msg)) {
          throw new Error(
            `DOMAIN BLOCKED BY PROXY. You MUST call the RequestNetworkAccess tool to request access for this domain. Do NOT retry curl — the domain is blocked at the network level.\n\n${msg}`
          );
        }
        throw err;
      }
    },
  };
}
