import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-008: Public tenant lookup by tenantId resolves metadata
 * Covers: GET /api/directory/tenants/lookup
 *
 * The lookup route declares `requireAuth: false` and backs login/activation flows.
 * The query schema requires a UUID, so a malformed id is rejected with 400 and a
 * well-formed-but-unknown id yields 404.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// Well-formed v4 UUID that will not exist as a tenant (deterministic, not seeded).
const NON_EXISTENT_TENANT_ID = '11111111-1111-4111-8111-111111111111';

type TenantLookupBody = {
  ok?: boolean;
  tenant?: { id?: string; name?: string };
  error?: string;
};

test.describe('TC-DIR-008: Public tenant lookup by tenantId', () => {
  let superToken: string | null = null;
  let tenantId: string | null = null;
  const stamp = Date.now();
  const tenantName = `QA TC-DIR-008 ${stamp}`;

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    const createRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: tenantName },
    });
    expect(createRes.status(), 'superadmin should create the tenant fixture').toBe(201);
    tenantId = ((await createRes.json()) as { id?: string }).id ?? null;
    expect(tenantId, 'tenant fixture id').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantId);
  });

  test('resolves tenant metadata for a known tenantId without authentication', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/directory/tenants/lookup?tenantId=${encodeURIComponent(tenantId!)}`,
    );
    expect(res.status(), 'lookup with a known tenantId should return 200').toBe(200);
    const body = (await res.json()) as TenantLookupBody;
    expect(body.ok, 'ok should be true').toBe(true);
    expect(body.tenant?.id, 'tenant.id should match the requested tenantId').toBe(tenantId);
    expect(body.tenant?.name, 'tenant.name should be returned').toBe(tenantName);
  });

  test('returns 400 for a malformed (non-UUID) tenantId', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/directory/tenants/lookup?tenantId=not-a-uuid`);
    expect(res.status(), 'malformed tenantId should return 400').toBe(400);
    const body = (await res.json()) as TenantLookupBody;
    expect(body.ok, 'ok should be false for a malformed tenantId').toBe(false);
  });

  test('returns 404 for a well-formed but non-existent tenantId', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/directory/tenants/lookup?tenantId=${NON_EXISTENT_TENANT_ID}`,
    );
    expect(res.status(), 'unknown tenantId should return 404').toBe(404);
    const body = (await res.json()) as TenantLookupBody;
    expect(body.ok, 'ok should be false for an unknown tenantId').toBe(false);
  });
});
