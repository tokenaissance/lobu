import { beforeAll, describe, expect, it } from 'vitest';
import { installAgentFromTemplate, resyncInstalledAgent } from '../../../agents/install';
import { cleanupTestDatabase, getTestDb } from '../../setup/test-db';
import {
  addUserToOrganization,
  createTestAgent,
  createTestOrganization,
  createTestUser,
} from '../../setup/test-fixtures';

describe('installAgentFromTemplate', () => {
  let templateOrg: Awaited<ReturnType<typeof createTestOrganization>>;
  let templateAgent: Awaited<ReturnType<typeof createTestAgent>>;
  let userOrg: Awaited<ReturnType<typeof createTestOrganization>>;
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await cleanupTestDatabase();
    const sql = getTestDb();

    templateOrg = await createTestOrganization({
      name: 'Personal Finance Template',
      slug: 'personal-finance-tpl',
    });
    templateAgent = await createTestAgent({
      organizationId: templateOrg.id,
      name: 'Personal Finance',
    });

    user = await createTestUser();
    userOrg = await createTestOrganization({ name: 'User Personal Org' });
    await addUserToOrganization(user.id, userOrg.id, 'owner');

    // Seed two entity types and one relationship type in the template org.
    await sql`
      INSERT INTO entity_types (slug, name, description, metadata_schema, organization_id, created_by)
      VALUES
        ('tax_year', 'Tax Year', 'Fiscal year', '{"type":"object"}'::jsonb, ${templateOrg.id}, ${user.id}),
        ('transaction', 'Transaction', 'A debit/credit', '{"type":"object"}'::jsonb, ${templateOrg.id}, ${user.id})
    `;
    await sql`
      INSERT INTO entity_relationship_types (slug, name, description, metadata_schema, organization_id, created_by, status)
      VALUES
        ('for_tax_year', 'For Tax Year', NULL, '{"type":"object"}'::jsonb, ${templateOrg.id}, ${user.id}, 'active')
    `;
  });

  it('creates a new agent row in the target org with template_agent_id set', async () => {
    const result = await installAgentFromTemplate({
      templateAgentId: templateAgent.agentId,
      targetOrganizationId: userOrg.id,
      userId: user.id,
    });

    expect(result.created).toBe(true);
    expect(result.mirrored.entity_types).toBe(2);
    expect(result.mirrored.entity_relationship_types).toBe(1);

    const sql = getTestDb();
    const rows = await sql`
      SELECT id, template_agent_id, organization_id, owner_user_id
      FROM agents
      WHERE id = ${result.agentId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].template_agent_id).toBe(templateAgent.agentId);
    expect(rows[0].organization_id).toBe(userOrg.id);
    expect(rows[0].owner_user_id).toBe(user.id);
  });

  it('mirrors entity types with managed_by_template_agent_id set', async () => {
    const sql = getTestDb();
    const rows = await sql`
      SELECT slug, managed_by_template_agent_id, source_template_org_id
      FROM entity_types
      WHERE organization_id = ${userOrg.id}
      ORDER BY slug
    `;
    expect(rows.map((r: { slug: string }) => r.slug)).toEqual(['tax_year', 'transaction']);
    for (const row of rows) {
      expect(row.managed_by_template_agent_id).toBe(templateAgent.agentId);
      expect(row.source_template_org_id).toBe(templateOrg.id);
    }
  });

  it('mirrors relationship types with managed_by_template_agent_id set', async () => {
    const sql = getTestDb();
    const rows = await sql`
      SELECT slug, managed_by_template_agent_id, source_template_org_id
      FROM entity_relationship_types
      WHERE organization_id = ${userOrg.id}
      ORDER BY slug
    `;
    expect(rows.map((r: { slug: string }) => r.slug)).toEqual(['for_tax_year']);
    expect(rows[0].managed_by_template_agent_id).toBe(templateAgent.agentId);
  });

  it('is idempotent: re-installing updates rather than creating duplicates', async () => {
    const result = await installAgentFromTemplate({
      templateAgentId: templateAgent.agentId,
      targetOrganizationId: userOrg.id,
      userId: user.id,
    });
    expect(result.created).toBe(false);

    const sql = getTestDb();
    const agentCount = await sql`
      SELECT COUNT(*)::int AS count
      FROM agents
      WHERE template_agent_id = ${templateAgent.agentId}
        AND organization_id = ${userOrg.id}
    `;
    expect(agentCount[0].count).toBe(1);

    const typeCount = await sql`
      SELECT COUNT(*)::int AS count
      FROM entity_types
      WHERE organization_id = ${userOrg.id}
        AND managed_by_template_agent_id = ${templateAgent.agentId}
    `;
    expect(typeCount[0].count).toBe(2);
  });

  it('re-sync propagates template changes to the mirror', async () => {
    const sql = getTestDb();
    // Simulate a template-side description change.
    await sql`
      UPDATE entity_types
      SET description = 'UK fiscal year (6 April to 5 April)'
      WHERE organization_id = ${templateOrg.id}
        AND slug = 'tax_year'
    `;

    const installed = await sql`
      SELECT id FROM agents
      WHERE template_agent_id = ${templateAgent.agentId}
        AND organization_id = ${userOrg.id}
      LIMIT 1
    `;
    await resyncInstalledAgent({
      installedAgentId: installed[0].id as string,
      userId: user.id,
    });

    const mirrored = await sql`
      SELECT description FROM entity_types
      WHERE organization_id = ${userOrg.id}
        AND slug = 'tax_year'
    `;
    expect(mirrored[0].description).toBe('UK fiscal year (6 April to 5 April)');
  });

  it('refuses to install into the template org itself', async () => {
    await expect(
      installAgentFromTemplate({
        templateAgentId: templateAgent.agentId,
        targetOrganizationId: templateOrg.id,
        userId: user.id,
      })
    ).rejects.toThrow(/Cannot install template agent into its own org/);
  });

  it('refuses to overwrite a user-authored row of the same slug', async () => {
    const sql = getTestDb();
    const otherOrg = await createTestOrganization({ name: 'Other User Org' });
    await addUserToOrganization(user.id, otherOrg.id, 'owner');
    await sql`
      INSERT INTO entity_types (slug, name, description, metadata_schema, organization_id, created_by)
      VALUES ('transaction', 'User Transaction', 'Manual row', '{"type":"object"}'::jsonb, ${otherOrg.id}, ${user.id})
    `;
    await expect(
      installAgentFromTemplate({
        templateAgentId: templateAgent.agentId,
        targetOrganizationId: otherOrg.id,
        userId: user.id,
      })
    ).rejects.toThrow(/user-authored/);
  });
});
