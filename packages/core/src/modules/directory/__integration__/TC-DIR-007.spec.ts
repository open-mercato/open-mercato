import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  getTokenContext,
  deleteGeneralEntityIfExists,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-DIR-007: Public organization lookup by slug resolves tenant context
 * Covers: GET /api/directory/organizations/lookup
 *
 * The lookup route declares `requireAuth: false` and is used by portal flows, so it
 * must resolve without an Authorization header. Validation rejects an empty slug (400)
 * and a missing organization yields 404.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

type OrgLookupBody = {
  ok?: boolean;
  organization?: { id?: string; name?: string; slug?: string; tenantId?: string | null };
  error?: string;
};

test.describe('TC-DIR-007: Public organization lookup by slug', () => {
  let superToken: string | null = null;
  let tenantId = '';
  let orgId: string | null = null;
  const stamp = Date.now();
  const orgName = `QA TC-DIR-007 ${stamp}`;
  const slug = `qa-tc-dir-007-${stamp}`;

  test.beforeAll(async ({ request }) => {
    superToken = await getAuthToken(request, 'superadmin');
    tenantId = getTokenContext(superToken).tenantId;

    const createRes = await apiRequest(request, 'POST', '/api/directory/organizations', {
      token: superToken,
      data: { name: orgName, slug, tenantId },
    });
    expect(createRes.status(), 'superadmin should create the organization fixture').toBe(201);
    orgId = ((await createRes.json()) as { id?: string }).id ?? null;
    expect(orgId, 'organization fixture id').toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    await deleteGeneralEntityIfExists(request, superToken, '/api/directory/organizations', orgId);
  });

  test('resolves organization metadata for a known slug without authentication', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/directory/organizations/lookup?slug=${encodeURIComponent(slug)}`,
    );
    expect(res.status(), 'lookup with a known slug should return 200').toBe(200);
    const body = (await res.json()) as OrgLookupBody;
    expect(body.ok, 'ok should be true').toBe(true);
    expect(body.organization?.id, 'organization.id should match the fixture').toBe(orgId);
    expect(body.organization?.name, 'organization.name should be returned').toBe(orgName);
    expect(body.organization?.slug, 'organization.slug should be returned').toBe(slug);
    expect(
      body.organization?.tenantId,
      'organization.tenantId must NOT be exposed by the public lookup',
    ).toBeUndefined();
  });

  test('returns 404 for a slug that does not resolve to any organization', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/directory/organizations/lookup?slug=${encodeURIComponent(`missing-${stamp}`)}`,
    );
    expect(res.status(), 'unknown slug should return 404').toBe(404);
    const body = (await res.json()) as OrgLookupBody;
    expect(body.ok, 'ok should be false for an unknown slug').toBe(false);
  });

  test('returns 400 for an empty slug', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/directory/organizations/lookup?slug=`);
    expect(res.status(), 'empty slug should return 400').toBe(400);
    const body = (await res.json()) as OrgLookupBody;
    expect(body.ok, 'ok should be false for an empty slug').toBe(false);
  });
});
