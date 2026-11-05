import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-078: Entity role assignment lifecycle (person & company).
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source contract:
 * - Roles assign a USER to an entity with a free-text `roleType`. The client body
 *   is `{ roleType, userId }` (not `{ role }`); the route injects entity/scope.
 * - `POST /api/customers/{people|companies}/[id]/roles` → 201 `{ id }`.
 *   Gated by `customers.roles.manage` (admin has it via `customers.*`).
 * - `DELETE` uses a `?roleId=` QUERY param (there is no `/roles/[roleId]` subroute) → 200 `{ ok }`.
 * - Uniqueness is per `(entityType, entityId, roleType)`, so two distinct role types
 *   for the same user/entity coexist.
 */
test.describe('TC-CRM-078: Entity role assignment lifecycle', () => {
  test('assigns and unassigns roles on a person and a company', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let personId: string | null = null;
    let companyId: string | null = null;
    const createdPersonRoleIds: string[] = [];
    const createdCompanyRoleIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');
      const { userId } = getTokenScope(token);
      expect(userId.length > 0, 'admin token carries a user id').toBe(true);

      personId = await createPersonFixture(request, token, { firstName: 'Rhea', lastName: 'Role', displayName: `TC-CRM-078 P ${stamp}` });
      companyId = await createCompanyFixture(request, token, `TC-CRM-078 Co ${stamp}`);

      // Assign 'decision_maker' on the person.
      const createDecisionMaker = await apiRequest(request, 'POST', `/api/customers/people/${personId}/roles`, { token, data: { roleType: 'decision_maker', userId } });
      expect(createDecisionMaker.status(), 'role create returns 201').toBe(201);
      const decisionMakerRoleId = (await readJsonSafe<{ id: string }>(createDecisionMaker))?.id ?? '';
      expect(decisionMakerRoleId.length > 0, 'role create returns an id').toBe(true);
      createdPersonRoleIds.push(decisionMakerRoleId);

      const listAfterFirst = await apiRequest(request, 'GET', `/api/customers/people/${personId}/roles`, { token });
      expect(listAfterFirst.status()).toBe(200);
      const itemsAfterFirst = (await readJsonSafe<{ items: Array<{ id: string; roleType: string; userId: string }> }>(listAfterFirst))?.items ?? [];
      expect(itemsAfterFirst.some((role) => role.roleType === 'decision_maker' && role.userId === userId)).toBe(true);

      // Assign a second role ('influencer') — distinct role type, so both coexist.
      const createInfluencer = await apiRequest(request, 'POST', `/api/customers/people/${personId}/roles`, { token, data: { roleType: 'influencer', userId } });
      expect(createInfluencer.status()).toBe(201);
      const influencerRoleId = (await readJsonSafe<{ id: string }>(createInfluencer))?.id ?? '';
      createdPersonRoleIds.push(influencerRoleId);

      const listAfterSecond = await apiRequest(request, 'GET', `/api/customers/people/${personId}/roles`, { token });
      const roleTypesAfterSecond = (await readJsonSafe<{ items: Array<{ roleType: string }> }>(listAfterSecond))?.items?.map((role) => role.roleType) ?? [];
      expect(roleTypesAfterSecond).toEqual(expect.arrayContaining(['decision_maker', 'influencer']));

      // Unassign 'decision_maker' via the ?roleId= query param.
      const deleteDecisionMaker = await apiRequest(request, 'DELETE', `/api/customers/people/${personId}/roles?roleId=${decisionMakerRoleId}`, { token });
      expect(deleteDecisionMaker.status(), 'role delete returns 200').toBe(200);

      const listAfterDelete = await apiRequest(request, 'GET', `/api/customers/people/${personId}/roles`, { token });
      const itemsAfterDelete = (await readJsonSafe<{ items: Array<{ id: string; roleType: string }> }>(listAfterDelete))?.items ?? [];
      expect(itemsAfterDelete.some((role) => role.roleType === 'decision_maker')).toBe(false);
      expect(itemsAfterDelete.some((role) => role.id === influencerRoleId)).toBe(true);

      // Company roles mirror person roles.
      const createCompanyRole = await apiRequest(request, 'POST', `/api/customers/companies/${companyId}/roles`, { token, data: { roleType: 'vendor', userId } });
      expect(createCompanyRole.status()).toBe(201);
      const companyRoleId = (await readJsonSafe<{ id: string }>(createCompanyRole))?.id ?? '';
      createdCompanyRoleIds.push(companyRoleId);

      const deleteCompanyRole = await apiRequest(request, 'DELETE', `/api/customers/companies/${companyId}/roles?roleId=${companyRoleId}`, { token });
      expect(deleteCompanyRole.status()).toBe(200);

      const listCompanyRoles = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}/roles`, { token });
      const companyRoleItems = (await readJsonSafe<{ items: unknown[] }>(listCompanyRoles))?.items ?? [];
      expect(companyRoleItems.length).toBe(0);
    } finally {
      // Delete every role row we created (id-linked rows are NOT cascaded by the
      // soft-delete of the parent person/company), idempotently and failure-safe.
      for (const roleId of createdPersonRoleIds) {
        if (token && personId) {
          await apiRequest(request, 'DELETE', `/api/customers/people/${personId}/roles?roleId=${roleId}`, { token }).catch(() => undefined);
        }
      }
      for (const roleId of createdCompanyRoleIds) {
        if (token && companyId) {
          await apiRequest(request, 'DELETE', `/api/customers/companies/${companyId}/roles?roleId=${roleId}`, { token }).catch(() => undefined);
        }
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
