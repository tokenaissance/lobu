import type { AgentMetadataStore } from "../../auth/agent-metadata-store";
import type { SettingsTokenPayload } from "../../auth/settings/token-service";
import type { UserAgentsStore } from "../../auth/user-agents-store";
import { getAuthMethod } from "../../connections/platform-auth-methods";

export interface AgentAccessConfig {
  userAgentsStore: UserAgentsStore;
  agentMetadataStore: AgentMetadataStore;
}

export function resolveSettingsLookupUserId(
  session: SettingsTokenPayload
): string {
  const isDeterministic = getAuthMethod(session.platform).type !== "oauth";
  return isDeterministic
    ? session.userId
    : session.oauthUserId || session.userId;
}

export async function verifyAgentAccess(
  session: SettingsTokenPayload,
  agentId: string,
  config: AgentAccessConfig
): Promise<boolean> {
  if (session.isAdmin) return true;

  if (session.agentId) {
    return session.agentId === agentId;
  }

  const lookupUserId = resolveSettingsLookupUserId(session);
  const owns = await config.userAgentsStore.ownsAgent(
    session.platform,
    lookupUserId,
    agentId
  );
  if (owns) return true;

  const metadata = await config.agentMetadataStore.getMetadata(agentId);
  if (!metadata) return false;

  return (
    metadata.owner?.platform === session.platform &&
    metadata.owner?.userId === lookupUserId
  );
}
