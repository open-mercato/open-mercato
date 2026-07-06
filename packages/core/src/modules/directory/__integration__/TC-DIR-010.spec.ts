import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-010: Tenant create name length constraints
 * Covers: POST /api/directory/tenants
 *
 * `tenantCreateSchema.name` is `z.string().min(1).max(200)`. An empty name and a name
 * longer than 200 characters both fail validation; the CRUD factory maps the ZodError to
 * HTTP 400. A name within bounds is accepted (201).
 */
test.describe('TC-DIR-010: Tenant name validation', () => {
  let superToken: string | null = null;
  let validTenantId: string | null = null;
  const stamp = Date.now();

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', validTenantId);
  });

  test('rejects an empty name (400)', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken!,
      data: { name: '' },
    });
    expect(res.status(), 'an empty name should fail validation').toBe(400);
    const body = (await res.json()) as { id?: string };
    expect(body?.id, 'no tenant should be created').toBeFalsy();
  });

  test('rejects a name longer than 200 characters (400)', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken!,
      data: { name: 'a'.repeat(201) },
    });
    expect(res.status(), 'a name over 200 characters should fail validation').toBe(400);
    const body = (await res.json()) as { id?: string };
    expect(body?.id, 'no tenant should be created').toBeFalsy();
  });

  test('accepts a name within the 1-200 character bounds (201)', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken!,
      data: { name: `QA TC-DIR-010 Valid ${stamp}` },
    });
    expect(res.status(), 'a valid name should be accepted').toBe(201);
    validTenantId = ((await res.json()) as { id?: string }).id ?? null;
    expect(validTenantId, 'tenant id should be returned').toBeTruthy();
  });
});
