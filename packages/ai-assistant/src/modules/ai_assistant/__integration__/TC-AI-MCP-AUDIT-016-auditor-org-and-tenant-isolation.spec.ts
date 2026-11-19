import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { ACCESS_LOGS_PATH, DEAL_READ_TOOL, MCP_AUDIT_RESOURCE_KIND, executeTool } from './helpers/mcpFixtures';

/**
 * TC-AI-MCP-AUDIT-016 — Widened access-log reads stay inside the auditor's organizations and tenant.
 * Source: PR #9648 roadmap gap B-1.
 *
 * `actorScope=all` and a foreign `actorUserId` drop the actor predicate, so organization visibility
 * and the tenant filter become the only barriers. This proves, against the running app, that:
 *   - an auditor restricted to one organization never sees another organization's rows;
 *   - an auditor whose organization visibility is empty sees nothing (fail closed);
 *   - a tenant administrator never sees another tenant's rows, in either direction.
 */

type AccessLogItem = { context: Record<string, unknown> | null };
type AccessLogBody = { items?: AccessLogItem[]; canViewTenant?: boolean };

const PASSWORD = 'StrongSecret123!';
const CALLER_FEATURES = ['ai_assistant.view', 'customers.deals.view', 'audit_logs.view_self'];
const AUDITOR_FEATURES = ['audit_logs.view_self', 'audit_logs.view_tenant'];

async function createTenantFixture(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  return expectId(body?.id, 'Tenant creation response should include id');
}

async function listCorrelations(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<{ canViewTenant: boolean | undefined; correlations: string[] }> {
  const response = await apiRequest(
    request,
    'GET',
    `${ACCESS_LOGS_PATH}?resourceKind=${encodeURIComponent(MCP_AUDIT_RESOURCE_KIND)}&pageSize=100${query}`,
    { token },
  );
  expect(response.status(), `access log listing (${query || 'default'}) should return 200`).toBe(200);
  const body = await readJsonSafe<AccessLogBody>(response);
  const correlations = (body?.items ?? [])
    .map((item) => item.context?.correlationId)
    .filter((value): value is string => typeof value === 'string');
  return { canViewTenant: body?.canViewTenant, correlations };
}

test.describe('TC-AI-MCP-AUDIT-016: auditor organization and tenant isolation', () => {
  test('widened reads never cross organization visibility or tenant boundaries', async ({ request }) => {
    test.slow();
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId } = getTokenContext(superadminToken);
    expectId(tenantId, 'Superadmin token should carry a tenant');

    const stamp = randomUUID().slice(0, 8);
    const users: string[] = [];
    const roles: string[] = [];
    const organizations: string[] = [];
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;

    const createUser = async (label: string, organizationId: string, roleId: string): Promise<{ id: string; email: string }> => {
      const email = `qa-tc-mcp-audit-016-${label}-${stamp}@example.com`;
      const id = await createUserFixture(request, superadminToken, { email, password: PASSWORD, organizationId, roles: [roleId] });
      users.push(id);
      return { id, email };
    };
    const createRole = async (label: string, roleTenantId: string, features: string[], visible: string[] | null): Promise<string> => {
      const roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-mcp-audit-016-${label}-${stamp}`, tenantId: roleTenantId });
      roles.push(roleId);
      await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: visible });
      return roleId;
    };
    const callTool = async (token: string, correlationId: string) => {
      const response = await executeTool(request, token, DEAL_READ_TOOL, { limit: 1 }, correlationId);
      expect([200, 400], `unexpected execute status ${response.status()} for ${correlationId}`).toContain(response.status());
    };

    try {
      const orgA1 = await createOrganizationFixture(request, superadminToken, { name: `QA MCP-AUDIT-016 A1 ${stamp}`, tenantId });
      organizations.push(orgA1);
      const orgA2 = await createOrganizationFixture(request, superadminToken, { name: `QA MCP-AUDIT-016 A2 ${stamp}`, tenantId });
      organizations.push(orgA2);
      const tempHome = await createOrganizationFixture(request, superadminToken, { name: `QA MCP-AUDIT-016 home ${stamp}`, tenantId });
      organizations.push(tempHome);

      const callerRole = await createRole('caller', tenantId, CALLER_FEATURES, null);
      const restrictedRole = await createRole('restricted', tenantId, AUDITOR_FEATURES, [orgA1]);
      const emptyRole = await createRole('empty', tenantId, AUDITOR_FEATURES, []);

      const callerA1 = await createUser('caller-a1', orgA1, callerRole);
      const callerA2 = await createUser('caller-a2', orgA2, callerRole);
      const restricted = await createUser('restricted', orgA1, restrictedRole);
      const emptyAuditor = await createUser('empty', tempHome, emptyRole);

      const removeHome = await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${encodeURIComponent(tempHome)}`, { token: superadminToken });
      expect(removeHome.status(), 'temporary home organization should be deleted before login').toBe(200);

      foreignTenantId = await createTenantFixture(request, superadminToken, `QA MCP-AUDIT-016 Tenant B ${stamp}`);
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, { name: `QA MCP-AUDIT-016 B ${stamp}`, tenantId: foreignTenantId });
      const foreignRole = await createRole('tenant-b', foreignTenantId, [...CALLER_FEATURES, 'audit_logs.view_tenant'], null);
      const foreignUser = await createUser('tenant-b', foreignOrganizationId, foreignRole);

      const callerA1Token = await getAuthToken(request, callerA1.email, PASSWORD);
      const callerA2Token = await getAuthToken(request, callerA2.email, PASSWORD);
      const restrictedToken = await getAuthToken(request, restricted.email, PASSWORD);
      const emptyToken = await getAuthToken(request, emptyAuditor.email, PASSWORD);
      const foreignToken = await getAuthToken(request, foreignUser.email, PASSWORD);

      const corrA1 = `it-mcp-016-a1-${stamp}`;
      const corrA2 = `it-mcp-016-a2-${stamp}`;
      const corrB = `it-mcp-016-b-${stamp}`;
      await callTool(callerA1Token, corrA1);
      await callTool(callerA2Token, corrA2);
      await callTool(foreignToken, corrB);

      await expect
        .poll(async () => {
          const inA1 = await listCorrelations(request, adminToken, `&actorScope=all&organizationId=${orgA1}`);
          const inA2 = await listCorrelations(request, adminToken, `&actorScope=all&organizationId=${orgA2}`);
          return inA1.correlations.includes(corrA1) && inA2.correlations.includes(corrA2);
        }, { timeout: 15_000, message: 'tenant admin should see each organization of its tenant when selected' })
        .toBe(true);

      const adminInForeignOrg = await listCorrelations(request, adminToken, `&actorScope=all&organizationId=${foreignOrganizationId}`);
      expect(adminInForeignOrg.correlations, 'naming a tenant B organization must not expose tenant B rows').not.toContain(corrB);
      const adminDefault = await listCorrelations(request, adminToken, '&actorScope=all');
      expect(adminDefault.correlations, 'tenant A admin must not see tenant B rows').not.toContain(corrB);

      const restrictedAll = await listCorrelations(request, restrictedToken, '&actorScope=all');
      expect(restrictedAll.canViewTenant, 'restricted auditor holds view_tenant').toBe(true);
      expect(restrictedAll.correlations, 'restricted auditor sees its organization').toContain(corrA1);
      expect(restrictedAll.correlations, 'restricted auditor must not see a hidden organization').not.toContain(corrA2);
      expect(restrictedAll.correlations, 'restricted auditor must not see another tenant').not.toContain(corrB);

      const restrictedForeignOrg = await listCorrelations(request, restrictedToken, `&actorScope=all&organizationId=${orgA2}`);
      expect(restrictedForeignOrg.correlations, 'selecting a hidden organization must not widen visibility').not.toContain(corrA2);

      const restrictedForeignActor = await listCorrelations(request, restrictedToken, `&actorUserId=${callerA2.id}`);
      expect(restrictedForeignActor.correlations, 'actorUserId must not reach a hidden organization').not.toContain(corrA2);

      const emptyAll = await listCorrelations(request, emptyToken, '&actorScope=all');
      const emptyForeignActor = await listCorrelations(request, emptyToken, `&actorUserId=${callerA1.id}`);
      expect(emptyAll.canViewTenant, 'empty-visibility auditor still holds view_tenant, so the fail-closed branch is exercised').toBe(true);
      for (const [label, result] of [['actorScope=all', emptyAll], ['actorUserId', emptyForeignActor]] as const) {
        expect(result.correlations, `empty-visibility auditor (${label}) must not see A1`).not.toContain(corrA1);
        expect(result.correlations, `empty-visibility auditor (${label}) must not see A2`).not.toContain(corrA2);
        expect(result.correlations, `empty-visibility auditor (${label}) must not see tenant B`).not.toContain(corrB);
      }

      const foreignAll = await listCorrelations(request, foreignToken, '&actorScope=all');
      expect(foreignAll.correlations, 'tenant B admin sees its own tenant').toContain(corrB);
      expect(foreignAll.correlations, 'tenant B admin must not see tenant A rows').not.toContain(corrA1);
      expect(foreignAll.correlations, 'tenant B admin must not see tenant A rows').not.toContain(corrA2);

      const foreignActor = await listCorrelations(request, foreignToken, `&actorUserId=${callerA1.id}`);
      expect(foreignActor.correlations, 'a foreign-tenant actorUserId must return nothing from tenant A').not.toContain(corrA1);
    } finally {
      for (const userId of users) await deleteUserIfExists(request, superadminToken, userId);
      for (const roleId of roles) await deleteRoleIfExists(request, superadminToken, roleId);
      for (const organizationId of organizations) await deleteOrganizationIfExists(request, superadminToken, organizationId);
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
    }
  });
});
