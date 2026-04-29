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
  const org = resolveOrg(undefined, session, options.storePath);

  if (isJson()) {
    printJson({ org: org || null, server: key });
    return;
  }

  printText(`org: ${org || "(none)"}`);
  printText(`server: ${key || "(none)"}`);
}

export function memoryOrgSetCommand(
  orgSlug: string,
  options: OrgOptions = {}
): void {
  setActiveOrg(orgSlug, options.storePath);

  if (isJson()) {
    printJson({ org: orgSlug });
  } else {
    printText(`Default memory org: ${orgSlug}`);
  }
}
