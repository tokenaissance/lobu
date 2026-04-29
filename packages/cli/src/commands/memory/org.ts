import {
  getActiveSession,
  resolveOrg,
  setActiveOrg,
} from "./_lib/openclaw-auth.js";
import { isJson, printJson, printText } from "./_lib/output.js";

interface OrgOptions {
  storePath?: string;
}

export function memoryOrgCurrentCommand(options: OrgOptions = {}): void {
  const { session, key } = getActiveSession(options.storePath);

  if (!session || !key) {
    if (isJson()) {
      printJson({ org: null });
    } else {
      printText("No active session. Run: lobu memory login");
    }
    return;
  }

  const org = resolveOrg(undefined, session);

  if (isJson()) {
    printJson({ org: org || null, server: key });
  } else {
    printText(`org: ${org || "(none)"}`);
    printText(`server: ${key}`);
  }
}

export function memoryOrgSetCommand(
  orgSlug: string,
  options: OrgOptions = {}
): void {
  setActiveOrg(orgSlug, options.storePath);

  if (isJson()) {
    printJson({ org: orgSlug });
  } else {
    printText(`Default org: ${orgSlug}`);
  }
}
