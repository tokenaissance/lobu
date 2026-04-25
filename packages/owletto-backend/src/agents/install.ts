/**
 * Install a template agent into a target organization.
 *
 * A template agent (e.g. the `personal-finance` agent in examples/) lives in a
 * template org and owns a canonical set of entity types and relationship types
 * that define its data model. When a user installs the agent we:
 *
 *   1. Create a new agents row in the user's org with template_agent_id set
 *      (Lobu's existing template-inheritance applies to agents.* settings —
 *      prompt, tools, mcp_servers, etc. — without any copy step).
 *   2. Mirror the template org's entity_types and entity_relationship_types
 *      into the user's org, tagged managed_by_template_agent_id so we can
 *      re-sync on template updates and treat them as read-only from the
 *      user's side.
 *
 * Classifiers and watchers are NOT mirrored in this module yet — they have
 * versioning/reaction-script tables that make them a separate concern.
 * The install is idempotent: re-running against the same target simply
 * UPDATEs the mirror rows (allowing template schema evolution).
 *
 * Safety: the mirror never overwrites rows the user authored directly
 * (managed_by_template_agent_id IS NULL). Slug collisions of that kind
 * abort the install with a descriptive error.
 */

import { generateSecureToken } from '../auth/oauth/utils';
import { getDb } from '../db/client';

export interface InstallResult {
  agentId: string;
  organizationId: string;
  mirrored: {
    entity_types: number;
    entity_relationship_types: number;
  };
  created: boolean;
}

export interface InstallAgentParams {
  templateAgentId: string;
  targetOrganizationId: string;
  userId: string;
  /** Optional override for the installed agent's display name. */
  name?: string;
}

type Sql = ReturnType<typeof getDb>;

interface TemplateAgentRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
}

async function loadTemplateAgent(sql: Sql, templateAgentId: string): Promise<TemplateAgentRow> {
  const rows = await sql`
    SELECT id, organization_id, name, description
    FROM agents
    WHERE id = ${templateAgentId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error(`Template agent ${templateAgentId} not found`);
  }
  return rows[0] as TemplateAgentRow;
}

async function findExistingInstall(
  sql: Sql,
  templateAgentId: string,
  targetOrganizationId: string
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM agents
    WHERE template_agent_id = ${templateAgentId}
      AND organization_id = ${targetOrganizationId}
    LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].id as string) : null;
}

async function upsertInstalledAgent(
  sql: Sql,
  params: {
    existingAgentId: string | null;
    template: TemplateAgentRow;
    targetOrganizationId: string;
    userId: string;
    name?: string;
  }
): Promise<{ agentId: string; created: boolean }> {
  if (params.existingAgentId) {
    await sql`
      UPDATE agents
      SET updated_at = NOW(),
          name = ${params.name ?? params.template.name},
          description = ${params.template.description}
      WHERE id = ${params.existingAgentId}
    `;
    return { agentId: params.existingAgentId, created: false };
  }

  const agentId = `agent_${generateSecureToken(8).toLowerCase()}`;
  await sql`
    INSERT INTO agents (
      id, organization_id, name, description,
      owner_platform, owner_user_id,
      template_agent_id,
      is_workspace_agent,
      created_at, updated_at
    ) VALUES (
      ${agentId},
      ${params.targetOrganizationId},
      ${params.name ?? params.template.name},
      ${params.template.description},
      'owletto',
      ${params.userId},
      ${params.template.id},
      false,
      NOW(), NOW()
    )
  `;
  return { agentId, created: true };
}

interface EntityTypeRow {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  metadata_schema: Record<string, unknown> | null;
  event_kinds: Record<string, unknown> | null;
}

async function mirrorEntityTypes(
  sql: Sql,
  templateOrgId: string,
  targetOrgId: string,
  templateAgentId: string,
  userId: string
): Promise<number> {
  const templateRows = (await sql`
    SELECT slug, name, description, icon, color, metadata_schema, event_kinds
    FROM entity_types
    WHERE organization_id = ${templateOrgId}
      AND deleted_at IS NULL
  `) as EntityTypeRow[];

  let count = 0;
  for (const row of templateRows) {
    const existing = await sql`
      SELECT id, managed_by_template_agent_id
      FROM entity_types
      WHERE organization_id = ${targetOrgId}
        AND slug = ${row.slug}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    const metadataSchema = row.metadata_schema ? sql.json(row.metadata_schema) : null;
    const eventKinds = row.event_kinds ? sql.json(row.event_kinds) : null;

    if (existing.length === 0) {
      await sql`
        INSERT INTO entity_types (
          slug, name, description, icon, color,
          metadata_schema, event_kinds,
          organization_id, created_by,
          managed_by_template_agent_id, source_template_org_id,
          created_at, updated_at
        ) VALUES (
          ${row.slug}, ${row.name}, ${row.description},
          ${row.icon}, ${row.color},
          ${metadataSchema}, ${eventKinds},
          ${targetOrgId}, ${userId},
          ${templateAgentId}, ${templateOrgId},
          NOW(), NOW()
        )
      `;
      count++;
      continue;
    }

    const existingOwner = existing[0].managed_by_template_agent_id as string | null;
    if (existingOwner === null) {
      throw new Error(
        `Entity type '${row.slug}' already exists in the target org as a user-authored row. Remove it or rename before installing this agent.`
      );
    }
    if (existingOwner !== templateAgentId) {
      throw new Error(
        `Entity type '${row.slug}' is already managed by a different template agent (${existingOwner}).`
      );
    }

    await sql`
      UPDATE entity_types
      SET name = ${row.name},
          description = ${row.description},
          icon = ${row.icon},
          color = ${row.color},
          metadata_schema = ${metadataSchema},
          event_kinds = ${eventKinds},
          updated_at = NOW(),
          updated_by = ${userId}
      WHERE id = ${existing[0].id}
    `;
    count++;
  }
  return count;
}

interface RelationshipTypeRow {
  slug: string;
  name: string;
  description: string | null;
  metadata_schema: Record<string, unknown> | null;
  is_symmetric: boolean;
}

async function mirrorRelationshipTypes(
  sql: Sql,
  templateOrgId: string,
  targetOrgId: string,
  templateAgentId: string,
  userId: string
): Promise<number> {
  const templateRows = (await sql`
    SELECT slug, name, description, metadata_schema, is_symmetric
    FROM entity_relationship_types
    WHERE organization_id = ${templateOrgId}
      AND status = 'active'
  `) as RelationshipTypeRow[];

  let count = 0;
  for (const row of templateRows) {
    const existing = await sql`
      SELECT id, managed_by_template_agent_id
      FROM entity_relationship_types
      WHERE organization_id = ${targetOrgId}
        AND slug = ${row.slug}
        AND status = 'active'
      LIMIT 1
    `;

    const metadataSchema = row.metadata_schema ? sql.json(row.metadata_schema) : null;

    if (existing.length === 0) {
      await sql`
        INSERT INTO entity_relationship_types (
          slug, name, description, metadata_schema,
          is_symmetric, organization_id, created_by,
          managed_by_template_agent_id, source_template_org_id,
          status, created_at, updated_at
        ) VALUES (
          ${row.slug}, ${row.name}, ${row.description}, ${metadataSchema},
          ${row.is_symmetric}, ${targetOrgId}, ${userId},
          ${templateAgentId}, ${templateOrgId},
          'active', NOW(), NOW()
        )
      `;
      count++;
      continue;
    }

    const existingOwner = existing[0].managed_by_template_agent_id as string | null;
    if (existingOwner === null) {
      throw new Error(
        `Relationship type '${row.slug}' already exists in the target org as a user-authored row. Remove it or rename before installing this agent.`
      );
    }
    if (existingOwner !== templateAgentId) {
      throw new Error(
        `Relationship type '${row.slug}' is already managed by a different template agent (${existingOwner}).`
      );
    }

    await sql`
      UPDATE entity_relationship_types
      SET name = ${row.name},
          description = ${row.description},
          metadata_schema = ${metadataSchema},
          is_symmetric = ${row.is_symmetric},
          updated_at = NOW()
      WHERE id = ${existing[0].id}
    `;
    count++;
  }
  return count;
}

export async function installAgentFromTemplate(
  params: InstallAgentParams
): Promise<InstallResult> {
  const sql = getDb();
  const template = await loadTemplateAgent(sql, params.templateAgentId);

  if (template.organization_id === params.targetOrganizationId) {
    throw new Error(
      `Cannot install template agent into its own org (${template.organization_id}). Pick a different target.`
    );
  }

  let result: InstallResult | null = null;

  await sql.begin(async (tx) => {
    const existingAgentId = await findExistingInstall(
      tx,
      params.templateAgentId,
      params.targetOrganizationId
    );
    const upsert = await upsertInstalledAgent(tx, {
      existingAgentId,
      template,
      targetOrganizationId: params.targetOrganizationId,
      userId: params.userId,
      name: params.name,
    });

    const entityTypes = await mirrorEntityTypes(
      tx,
      template.organization_id,
      params.targetOrganizationId,
      params.templateAgentId,
      params.userId
    );
    const relationshipTypes = await mirrorRelationshipTypes(
      tx,
      template.organization_id,
      params.targetOrganizationId,
      params.templateAgentId,
      params.userId
    );

    result = {
      agentId: upsert.agentId,
      organizationId: params.targetOrganizationId,
      mirrored: {
        entity_types: entityTypes,
        entity_relationship_types: relationshipTypes,
      },
      created: upsert.created,
    };
  });

  if (!result) {
    throw new Error('Install transaction did not produce a result');
  }
  return result;
}

export async function resyncInstalledAgent(params: {
  installedAgentId: string;
  userId: string;
}): Promise<InstallResult> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, organization_id, template_agent_id
    FROM agents
    WHERE id = ${params.installedAgentId}
    LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error(`Installed agent ${params.installedAgentId} not found`);
  }
  const row = rows[0] as {
    id: string;
    organization_id: string;
    template_agent_id: string | null;
  };
  if (!row.template_agent_id) {
    throw new Error(
      `Agent ${params.installedAgentId} has no template_agent_id — nothing to re-sync.`
    );
  }
  return installAgentFromTemplate({
    templateAgentId: row.template_agent_id,
    targetOrganizationId: row.organization_id,
    userId: params.userId,
  });
}
