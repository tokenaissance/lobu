/**
 * Cross-package lookup that resolves an inbound platform identity (e.g.
 * a WhatsApp JID) to the installed-agent instance the gateway should route
 * messages to. Backed by the same Postgres the rest of owletto-backend uses;
 * the gateway gets it via CoreServices.
 *
 * The data path:
 *   wa_jid → entity_identities → $member entity → its organization →
 *   the agent in that org with template_agent_id matching
 */

import { getDb } from '../db/client';
import { installAgentFromTemplate } from './install';
import { linkWhatsAppToMember } from '../auth/subject-identities';
import { isInstallTokenMessage, verifyInstallToken } from './install-token';

export interface InstalledAgentLocation {
  agentId: string;
  organizationId: string;
}

/**
 * Find the agent instance that should handle messages from `(platform, userId)`
 * for the given template. Returns null when the platform user hasn't yet
 * installed the template agent in their personal org.
 */
export async function findInstalledAgentByIdentity(params: {
  platform: string;
  platformUserId: string;
  templateAgentId: string;
}): Promise<InstalledAgentLocation | null> {
  const sql = getDb();
  const namespace = identityNamespaceForPlatform(params.platform);
  if (!namespace) return null;

  // Single query: from the inbound identifier, walk to the $member entity,
  // then to its organization, then to the agent installed in that org with
  // matching template_agent_id.
  const rows = await sql`
    SELECT a.id AS agent_id, a.organization_id
    FROM entity_identities ei
    JOIN entities m ON m.id = ei.entity_id
      AND m.entity_type = '$member'
      AND m.deleted_at IS NULL
    JOIN agents a ON a.organization_id = ei.organization_id
      AND a.template_agent_id = ${params.templateAgentId}
    WHERE ei.namespace = ${namespace}
      AND ei.identifier = ${params.platformUserId}
      AND ei.deleted_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    agentId: rows[0].agent_id as string,
    organizationId: rows[0].organization_id as string,
  };
}

function identityNamespaceForPlatform(platform: string): string | null {
  switch (platform.toLowerCase()) {
    case 'whatsapp':
      return 'wa_jid';
    case 'slack':
      return 'slack_user_id';
    case 'telegram':
      return 'telegram_user_id';
    default:
      return null;
  }
}

/**
 * Look up the email of the user who owns this Lobu user_id, used to bridge
 * back into linkWhatsAppToMember (which keys on email — same as ensureMemberEntity).
 */
async function getUserEmail(userId: string): Promise<string | null> {
  const sql = getDb();
  const rows = await sql`SELECT email FROM "user" WHERE id = ${userId} LIMIT 1`;
  if (rows.length === 0) return null;
  return rows[0].email as string;
}

interface ClaimResult {
  status: 'installed' | 'token_invalid' | 'token_expired' | 'no_personal_org' | 'no_member';
  agentId?: string;
  organizationId?: string;
  reason?: string;
}

/**
 * Process an inbound `install:<token>` message from a chat platform.
 * Validates the token, completes the install in the user's personal org,
 * and links the platform identity (e.g. wa_jid) to their $member.
 *
 * Returns a structured result the gateway can render back as a chat reply.
 */
export async function claimInstallFromChat(params: {
  message: string;
  platform: string;
  platformUserId: string;
}): Promise<ClaimResult> {
  if (!isInstallTokenMessage(params.message)) {
    return { status: 'token_invalid', reason: 'Message is not an install token' };
  }
  const verified = verifyInstallToken(params.message.trim());
  if (!verified.ok) {
    return verified.error === 'expired'
      ? { status: 'token_expired' }
      : { status: 'token_invalid', reason: verified.error };
  }

  const sql = getDb();
  const orgRows = await sql`
    SELECT id, slug FROM "organization"
    WHERE metadata IS NOT NULL
      AND metadata LIKE ${`%"personal_org_for_user_id":"${verified.userId}"%`}
    ORDER BY "createdAt" ASC, id ASC
    LIMIT 1
  `;
  if (orgRows.length === 0) {
    return { status: 'no_personal_org' };
  }
  const personalOrgId = orgRows[0].id as string;

  const installResult = await installAgentFromTemplate({
    templateAgentId: verified.templateAgentId,
    targetOrganizationId: personalOrgId,
    userId: verified.userId,
  });

  // Link the platform identity. linkWhatsAppToMember keys on email, so we
  // need it from the user row.
  if (params.platform.toLowerCase() === 'whatsapp') {
    const email = await getUserEmail(verified.userId);
    if (!email) return { status: 'no_member' };
    const linked = await linkWhatsAppToMember({
      organizationId: personalOrgId,
      email,
      // The platformUserId here is already a JID like "447...@s.whatsapp.net".
      // linkWhatsAppToMember normalizes from a phone string, so reverse-derive.
      rawPhone: jidToPhone(params.platformUserId),
    });
    if ('error' in linked) {
      return { status: 'no_member', reason: linked.error };
    }
  }

  return {
    status: 'installed',
    agentId: installResult.agentId,
    organizationId: installResult.organizationId,
  };
}

function jidToPhone(jid: string): string {
  const at = jid.indexOf('@');
  const digits = at >= 0 ? jid.slice(0, at) : jid;
  return `+${digits}`;
}
