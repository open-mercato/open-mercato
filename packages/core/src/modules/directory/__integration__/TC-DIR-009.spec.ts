import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  getTokenContext,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-009: Organization create slug constraint validation
 * Covers: POST /api/directory/organizations
 *
 * `organizationCreateSchema.slug` is `z.string().trim().toLowerCase().regex(/^[a-z0-9\-_]+$/)`.
 * The regex runs AFTER `.trim().toLowerCase()`, so:
 *  - slugs containing an internal space or a special character fail validation (the CRUD
 *    factory maps the ZodError to HTTP 400), while
 *  - an uppercase slug is normalized to lowercase and accepted (201) — it is NOT rejected.
 */
test.describe('TC-DIR-009: Organization slug validation', () => {
  let superToken: string | null = null;
  let tenantId = '';
  const stamp = Date.now();
  const createdOrgIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    tenantId = getTokenContext(superToken).tenantId;
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdOrgIds) {
      await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', id);
    }
  });

  test('rejects a slug containing an internal space (400)', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-009 space ${stamp}`, slug: 'invalid slug', tenantId },
    });
    expect(res.status(), 'a slug with a space should fail validation').toBe(400);
  });

  test('rejects a slug containing a special character (400)', async ({ request }) => {
    const res = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-009 special ${stamp}`, slug: 'invalid@slug', tenantId },
    });
    expect(res.status(), 'a slug with a special character should fail validation').toBe(400);
  });

  test('accepts a valid slug (201)', async ({ request }) => {
    const slug = `valid-slug-${stamp}`;
    const res = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-009 valid ${stamp}`, slug, tenantId },
    });
    expect(res.status(), 'a valid slug should be accepted').toBe(201);
    const id = ((await res.json()) as { id?: string }).id ?? null;
    expect(id, 'organization id should be returned').toBeTruthy();
    if (id) createdOrgIds.push(id);
  });

  test('normalizes an uppercase slug to lowercase rather than rejecting it (201)', async ({ request }) => {
    const requestedSlug = `Upper-Case-${stamp}`;
    const expectedSlug = requestedSlug.toLowerCase();
    const res = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken!,
      data: { name: `QA TC-DIR-009 upper ${stamp}`, slug: requestedSlug, tenantId },
    });
    expect(res.status(), 'an uppercase slug should be normalized and accepted').toBe(201);
    const id = ((await res.json()) as { id?: string }).id ?? null;
    expect(id, 'organization id should be returned').toBeTruthy();
    if (id) createdOrgIds.push(id);

    const getRes = await apiRequest(
      request,
      'GET',
      `/api/directory/organizations?view=manage&tenantId=${encodeURIComponent(tenantId)}&ids=${encodeURIComponent(id!)}`,
      { token: superToken! },
    );
    expect(getRes.status()).toBe(200);
    const body = (await getRes.json()) as { items?: Array<{ id?: string; slug?: string | null }> };
    const stored = (body.items ?? []).find((item) => item.id === id);
    expect(stored?.slug, 'the persisted slug should be lowercased').toBe(expectedSlug);
  });
});
