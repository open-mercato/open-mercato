import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  apiRequest,
  getAuthToken,
} from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  apiRequestWithSelectedOrg,
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/modules/core/__integration__/helpers/authFixtures';
import {
  clearUserHomeOrganization,
  deleteUserAclInDb,
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CRM-072: Organization-scope fail-open authorization hardening.
 *
 * Spec: .ai/specs/implemented/2026-05-29-org-scope-fail-open-authorization-hardening.md (Phase 3)
 * Issues: #2239 (write/command path) + #2245 (read/detail path).
 *
 * Vulnerability precondition (closed by the fix): a NON-super-admin user whose
 * home org resolves to null (`auth.orgId === null`) but whose org-visibility ACL
 * is a concrete-yet-non-matching set. Before the fix the guards FAILED OPEN
 * (skipped the check) and allowed cross-org read/write within the tenant.
 *
 * - WRITE (#2239): visibility `[orgA]` => `scope.allowedIds = [orgA]`. Acting on
 *   a record in orgB was allowed (fail-open); now 403. Acting on orgA still OK.
 * - READ (#2245): visibility `[]` => derived org set is EMPTY. Reading a record
 *   in any other org was allowed (fail-open: empty set => guard skipped); now 403.
 *
 * The home org is nulled in the DB BEFORE login because the JWT `auth.orgId` is
 * minted from `users.organization_id` at login time.
 *
 * ENVIRONMENT: this spec mixes API fixtures (hit the app) with DB-level fixtures
 * (raw `pg` against `DATABASE_URL`). It MUST run under a coherent app+DB stack
 * (the standard `yarn test:integration` / `yarn test:integration:ephemeral`
 * harness) where the app server and the fixtures share the same database. It is
 * NOT valid against an arbitrary already-running dev server whose `DATABASE_URL`
 * differs from `apps/mercato/.env` — the DB writes become no-ops the app cannot
 * see, so the preconditions are never established.
 */
test.describe('TC-CRM-072: org-scope fail-open authorization hardening (#2239 + #2245)', () => {
  test('denies cross-org write/read for a floating restricted user; allows in-scope', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    const password = 'Secret123!';

    let adminToken: string | null = null;
    let orgAId: string | null = null;
    let orgBId: string | null = null;
    let writeRoleId: string | null = null;
    let readRoleId: string | null = null;
    let writeUserId: string | null = null;
    let readUserId: string | null = null;
    let personOrgAId: string | null = null;
    let personOrgBId: string | null = null;

    const writeUserEmail = `tc-crm-072-write-${stamp}@example.com`;
    const readUserEmail = `tc-crm-072-read-${stamp}@example.com`;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { tenantId } = getTokenScope(adminToken);
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy();

      // Two organizations in the admin tenant. Created via DB: the directory
      // create command routes through enforceTenantSelection, which denies the
      // only loginable (non-super-admin) accounts on this instance.
      orgAId = await createOrganizationInDb({ name: `TC-CRM-072 Org A ${stamp}`, tenantId });
      orgBId = await createOrganizationInDb({ name: `TC-CRM-072 Org B ${stamp}`, tenantId });

      // People records placed in specific orgs via the om_selected_org cookie.
      personOrgAId = await createPersonInOrg(request, adminToken, orgAId, `TC-CRM-072 Person A ${stamp}`);
      personOrgBId = await createPersonInOrg(request, adminToken, orgBId, `TC-CRM-072 Person B ${stamp}`);

      // Sanity: the orgB person is reachable & actually lives in orgB (in-scope admin).
      const orgBDetail = await apiRequest(request, 'GET', `/api/customers/people/${personOrgBId}`, { token: adminToken });
      expect(orgBDetail.status(), 'admin (in-scope) can read the orgB person').toBe(200);
      const orgBBody = await readJsonSafe<{ person?: { organizationId?: string } }>(orgBDetail);
      expect(orgBBody?.person?.organizationId, 'orgB person must be in orgB').toBe(orgBId);

      // ---- WRITE precondition (#2239): floating user, visibility = [orgA] ----
      writeRoleId = await createRoleFixture(request, adminToken, { name: `TC-CRM-072 Write Role ${stamp}` });
      writeUserId = await createUserFixture(request, adminToken, {
        email: writeUserEmail,
        password,
        organizationId: orgAId,
        roles: [writeRoleId],
      });
      // Grant a customers feature superset so the feature gate passes; org-scope is
      // the only thing that can 403. Visibility=[orgA] => allowedIds=[orgA].
      // Set via the ACL API so the server's RBAC cache is invalidated.
      await setUserAclVisibility(request, adminToken, {
        userId: writeUserId,
        features: ['customers.*'],
        organizations: [orgAId],
      });
      await clearUserHomeOrganization(writeUserId);
      const writeToken = await getAuthToken(request, writeUserEmail, password);
      expect(decodeOrgId(writeToken), 'floating write user must have null home org in JWT').toBeNull();

      // People update routes through makeCrudRoute (Pattern A): the command ctx
      // carries the resolved OrganizationScope. `allowedIds` is derived from the
      // user's org-visibility ACL ([orgA]) and is independent of any selected-org
      // cookie. To exercise the #2239 fail-open we send NO selected org, so the
      // legacy `currentOrg` (selectedOrganizationId ?? auth.orgId) resolves to
      // null — the exact precondition where the OLD guard skipped the check
      // (returning 200) and the NEW guard denies because orgB ∉ allowedIds=[orgA].

      // WRITE deny (#2239): update a person in orgB with no selected org => 403.
      const denyWrite = await apiRequest(request, 'PUT', '/api/customers/people', {
        token: writeToken,
        data: { id: personOrgBId, organizationId: orgBId, description: `cross-org write attempt ${stamp}` },
      });
      expect(denyWrite.status(), 'cross-org PUT (orgB) must be forbidden (#2239)').toBe(403);

      // WRITE allow-path regression: update a person in orgA (in allowedIds) => success.
      const allowWrite = await apiRequest(request, 'PUT', '/api/customers/people', {
        token: writeToken,
        data: { id: personOrgAId, organizationId: orgAId, description: `in-scope write ${stamp}` },
      });
      expect(allowWrite.status(), 'in-scope PUT (orgA) must succeed').toBeLessThan(300);
      expect(allowWrite.status(), 'in-scope PUT (orgA) must succeed').toBeGreaterThanOrEqual(200);

      // ---- READ precondition (#2245): floating user, visibility = [] (zero orgs) ----
      readRoleId = await createRoleFixture(request, adminToken, { name: `TC-CRM-072 Read Role ${stamp}` });
      readUserId = await createUserFixture(request, adminToken, {
        email: readUserEmail,
        password,
        organizationId: orgAId,
        roles: [readRoleId],
      });
      // Visibility=[] => derived org set EMPTY => read guard must deny (was fail-open).
      await setUserAclVisibility(request, adminToken, {
        userId: readUserId,
        features: ['customers.*'],
        organizations: [],
      });
      await clearUserHomeOrganization(readUserId);
      const readToken = await getAuthToken(request, readUserEmail, password);
      expect(decodeOrgId(readToken), 'floating read user must have null home org in JWT').toBeNull();

      // READ deny: detail GET on the orgB person => 403 (was fail-open: empty set skipped guard).
      const denyRead = await apiRequest(request, 'GET', `/api/customers/people/${personOrgBId}`, { token: readToken });
      expect(denyRead.status(), 'cross-org detail GET (orgB) must be forbidden (#2245)').toBe(403);
    } finally {
      await deleteUserAclInDb(writeUserId ?? '').catch(() => undefined);
      await deleteUserAclInDb(readUserId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, writeUserId);
      await deleteUserIfExists(request, adminToken, readUserId);
      await deleteRoleIfExists(request, adminToken, writeRoleId);
      await deleteRoleIfExists(request, adminToken, readRoleId);
      await deletePersonIfExists(request, adminToken, personOrgAId);
      await deletePersonIfExists(request, adminToken, personOrgBId);
      await deleteOrganizationInDb(orgAId).catch(() => undefined);
      await deleteOrganizationInDb(orgBId).catch(() => undefined);
    }
  });
});

function decodeOrgId(token: string): string | null {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { orgId?: string | null };
  return payload.orgId ?? null;
}

async function createPersonInOrg(
  request: APIRequestContext,
  token: string,
  orgId: string,
  displayName: string,
): Promise<string> {
  const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/customers/people', {
    token,
    selectedOrgId: orgId,
    data: { firstName: 'TC072', lastName: 'Person', displayName },
  });
  expect(response.status(), `create person in org ${orgId} should return 201`).toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(typeof body?.id === 'string' && body.id.length > 0, 'person create response should include id').toBe(true);
  return body!.id as string;
}

async function deletePersonIfExists(
  request: APIRequestContext,
  token: string | null,
  personId: string | null,
): Promise<void> {
  if (!token || !personId) return;
  await apiRequest(request, 'DELETE', '/api/customers/people', { token, data: { id: personId } }).catch(() => undefined);
}
