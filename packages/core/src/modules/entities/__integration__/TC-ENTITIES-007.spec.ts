import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  listCustomEntities,
  uniqueEntityId,
} from './helpers/entitiesApi';

/**
 * TC-ENTITIES-007: Organization scoping isolates custom entities  [P1] (api)
 * Source: issue #2471.
 *
 * Custom entity definitions are scoped to the creator's home organization
 * (`GET /api/entities/entities` filters `organizationId IN (auth.orgId, null)`).
 * Two users in different organizations of the same tenant must not see each
 * other's org-scoped entities.
 *
 * Setup (all via API — verified against the running app):
 *   - superadmin creates a second organization in the admin's tenant,
 *   - creates a user there (roles: []) and grants it the `entities.*` features
 *     via a per-user ACL,
 *   - that user logs in with its own home-org JWT.
 * The seeded `admin` (org 1) and the new user (org 2) then create one entity each.
 */
test.describe('TC-ENTITIES-007: Organization scoping isolates custom entities', () => {
  test('a user in another org cannot see the admin org entity and vice versa', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const superToken = await getAuthToken(request, 'superadmin');
    const { tenantId } = getTokenContext(adminToken);
    const stamp = `${Date.now().toString(36)}${randomUUID().replaceAll('-', '').slice(0, 8)}`;

    let org2Id: string | null = null;
    let user2Id: string | null = null;
    let user2Token: string | null = null;
    const entityA = uniqueEntityId('org1'); // created by admin (org 1)
    const entityB = uniqueEntityId('org2'); // created by user2 (org 2)

    try {
      org2Id = await createOrganizationFixture(request, superToken, { name: `E2E Entities Scope Org ${stamp}`, tenantId });
      const user2Email = `e2e-entities-scope-${stamp}@acme.com`;
      const user2Password = 'Sched-View-1!';
      user2Id = await createUserFixture(request, superToken, {
        email: user2Email,
        password: user2Password,
        organizationId: org2Id,
        roles: [],
      });
      await setUserAclVisibility(request, superToken, {
        userId: user2Id,
        organizations: null,
        features: ['entities.definitions.view', 'entities.definitions.manage', 'entities.records.view', 'entities.records.manage'],
      });
      user2Token = await getAuthToken(request, user2Email, user2Password);

      // Sanity: the new user's JWT really resolves to the second organization.
      expect(getTokenContext(user2Token).organizationId, 'user2 home org is org 2').toBe(org2Id);
      expect(getTokenContext(user2Token).tenantId, 'user2 shares the admin tenant').toBe(tenantId);

      expect((await createCustomEntity(request, adminToken, { entityId: entityA, label: 'Scope A (org 1)' })).status(), 'admin creates entity A').toBe(200);
      expect((await createCustomEntity(request, user2Token, { entityId: entityB, label: 'Scope B (org 2)' })).status(), 'user2 creates entity B').toBe(200);

      const adminList = await readJsonSafe<{ items?: Array<{ entityId?: string }> }>(await listCustomEntities(request, adminToken));
      const adminIds = new Set((adminList?.items ?? []).map((it) => it.entityId));
      expect(adminIds.has(entityA), 'admin sees its own org entity A').toBe(true);
      expect(adminIds.has(entityB), 'admin does NOT see org 2 entity B').toBe(false);

      const user2List = await readJsonSafe<{ items?: Array<{ entityId?: string }> }>(await listCustomEntities(request, user2Token));
      const user2Ids = new Set((user2List?.items ?? []).map((it) => it.entityId));
      expect(user2Ids.has(entityB), 'user2 sees its own org entity B').toBe(true);
      expect(user2Ids.has(entityA), 'user2 does NOT see org 1 entity A').toBe(false);
    } finally {
      await deleteCustomEntityIfExists(request, adminToken, entityA);
      if (user2Token) await deleteCustomEntityIfExists(request, user2Token, entityB);
      await deleteUserIfExists(request, superToken, user2Id);
      await deleteOrganizationIfExists(request, superToken, org2Id);
    }
  });
});
