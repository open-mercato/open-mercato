import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-012: Organization slug uniqueness is enforced within a tenant
 * Covers: POST /api/directory/organizations
 *
 * Slug uniqueness per tenant is backed by the DB constraint `organizations_tenant_slug_uniq`
 * on (tenant_id, slug). The create command does NOT reject a colliding slug — it calls
 * `resolveUniqueSlug`, which auto-suffixes (`-1`, `-2`, ...) so the second create succeeds with
 * a distinct slug. The same slug is therefore unique *within* a tenant but allowed *across*
 * tenants. This test documents that contract: a same-tenant duplicate yields two organizations
 * with distinct slugs (no rejection), and the identical slug is accepted verbatim in another tenant.
 */
type ManageItem = { id?: string; slug?: string | null };

async function fetchOrgSlugs(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const res = await apiRequest(
    request,
    'GET',
    `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(ids.join(','))}`,
    { token },
  );
  expect(res.status(), 'manage list should return 200').toBe(200);
  const body = (await res.json()) as { items?: ManageItem[] };
  const map = new Map<string, string | null>();
  for (const item of body.items ?? []) {
    if (item.id) map.set(item.id, item.slug ?? null);
  }
  return map;
}

test.describe('TC-DIR-012: Organization slug uniqueness within a tenant', () => {
  let superToken: string | null = null;
  let tenantA: string | null = null;
  let tenantB: string | null = null;
  const orgIds: string[] = [];
  const stamp = Date.now();
  const slug = `dir-012-${stamp}`;

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    const tenantARes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `QA TC-DIR-012 A ${stamp}` },
    });
    expect(tenantARes.status()).toBe(201);
    tenantA = ((await tenantARes.json()) as { id?: string }).id ?? null;
    expect(tenantA).toBeTruthy();

    const tenantBRes = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `QA TC-DIR-012 B ${stamp}` },
    });
    expect(tenantBRes.status()).toBe(201);
    tenantB = ((await tenantBRes.json()) as { id?: string }).id ?? null;
    expect(tenantB).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    for (const id of orgIds) {
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', id);
    }
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantA);
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/tenants', tenantB);
  });

  test('a duplicate slug in the same tenant is auto-resolved, not rejected', async ({ request }) => {
    const firstRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-012 A1 ${stamp}`, slug, tenantId: tenantA },
    });
    expect(firstRes.status(), 'first org with the slug should be created').toBe(201);
    const firstId = ((await firstRes.json()) as { id?: string }).id!;
    expect(firstId).toBeTruthy();
    orgIds.push(firstId);

    const secondRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-012 A2 ${stamp}`, slug, tenantId: tenantA },
    });
    expect(secondRes.status(), 'duplicate slug in the same tenant should NOT be rejected').toBe(201);
    const secondId = ((await secondRes.json()) as { id?: string }).id!;
    expect(secondId).toBeTruthy();
    orgIds.push(secondId);

    const slugs = await fetchOrgSlugs(request, superToken!, tenantA!, [firstId, secondId]);
    expect(slugs.get(firstId), 'the first org should keep the requested slug').toBe(slug);
    expect(slugs.get(secondId), 'the second org should receive an auto-resolved slug').toBeTruthy();
    expect(
      slugs.get(secondId),
      'the auto-resolved slug must differ from the original',
    ).not.toBe(slug);
  });

  test('the same slug is allowed verbatim in a different tenant', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-012 B1 ${stamp}`, slug, tenantId: tenantB },
    });
    expect(res.status(), 'the same slug should be accepted in another tenant').toBe(201);
    const id = ((await res.json()) as { id?: string }).id!;
    expect(id).toBeTruthy();
    orgIds.push(id);

    const slugs = await fetchOrgSlugs(request, superToken!, tenantB!, [id]);
    expect(slugs.get(id), 'the slug should be stored verbatim in the other tenant').toBe(slug);
  });
});
