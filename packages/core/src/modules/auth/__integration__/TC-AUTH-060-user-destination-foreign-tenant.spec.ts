import { randomInt } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import { createUserDestinationFixture } from './helpers/userDestinationFixtures';

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  expect(response.status(), 'foreign tenant fixture should be created').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Tenant response should include id');
}

test.describe('TC-AUTH-060: foreign-tenant user destination', () => {
  test('hides a destination organization from another tenant', async ({ request }) => {
    const fixture = await createUserDestinationFixture(request, 'AUTH-060');
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;

    try {
      const targetUserId = await fixture.createUser({ emailPrefix: 'target' });
      const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
      foreignTenantId = await createTenant(request, fixture.superadminToken, `QA AUTH 060 Tenant ${stamp}`);
      foreignOrganizationId = await createOrganizationFixture(request, fixture.superadminToken, {
        name: `QA AUTH 060 Organization ${stamp}`,
        tenantId: foreignTenantId,
      });

      const response = await apiRequest(request, 'PUT', '/api/auth/users', {
        token: fixture.actorToken,
        data: { id: targetUserId, organizationId: foreignOrganizationId },
      });

      expect(response.status(), 'foreign-tenant destination should be hidden').toBe(404);
    } finally {
      await deleteOrganizationIfExists(request, fixture.superadminToken, foreignOrganizationId);
      await deleteGeneralEntityIfExists(
        request,
        fixture.superadminToken,
        '/api/directory/tenants',
        foreignTenantId,
      );
      await fixture.cleanup();
    }
  });
});
