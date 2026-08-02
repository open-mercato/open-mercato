import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-NAV-ORG-001: `GET /api/auth/admin/nav` reports the organization actually in scope.
 * Source spec: .ai/specs/2026-07-30-backend-chrome-current-organization.md ("Integration Coverage").
 *
 * Exercises `currentOrganization` through the real scope-resolution boundary rather than a mocked
 * one. That distinction matters: `resolveFeatureCheckContext`
 * (`modules/directory/utils/organizationScope.ts`) deliberately falls back to `auth.orgId` when
 * `scope.selectedId` is `null`, and `null` is exactly what the all-organizations selection produces.
 * A unit test that mocks the resolver can therefore "pass" while the real payload names the
 * caller's home organization during an all-organizations view — the opposite of the documented
 * contract.
 *
 * Verified-against-source contract (`modules/auth/api/admin/nav.ts`):
 * - the selection arrives as the `orgId` query parameter (`:113`), with `__all__`
 *   (`ALL_ORGANIZATIONS_COOKIE_VALUE`) meaning all organizations
 * - responses are cached under a key built from the *resolved* scope (`:141-142`), which is why the
 *   ordering assertions below matter: an all-organizations request and a home-organization request
 *   must not serve each other's payload
 */

const NAV_PATH = '/api/auth/admin/nav';
const ALL_ORGANIZATIONS = '__all__';

/**
 * The defect needs a caller that can select all organizations *and* whose token carries a home
 * organization — the fallback resolves to `auth.orgId`, so a caller without one would make these
 * assertions vacuous. `superadmin` can select both scopes; the concrete-selection test below proves
 * the resolver really can name an organization for this caller, which is what keeps the
 * all-organizations assertion meaningful.
 */
const ROLE = 'superadmin';

type NavPayload = {
  currentOrganization?: { id?: string; name?: string } | null;
  brand?: { name?: string } | null;
  groups?: unknown[];
};

async function fetchNav(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  orgId: string,
): Promise<NavPayload> {
  const response = await apiRequest(request, 'GET', `${NAV_PATH}?orgId=${encodeURIComponent(orgId)}`, { token });
  expect(response.status(), `GET ${NAV_PATH}?orgId=${orgId} should return 200`).toBe(200);
  return (await readJsonSafe<NavPayload>(response)) ?? {};
}

test.describe('admin nav current organization', () => {
  test('diagnostic: reports what the real scope resolution produces', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);
    const scope = getTokenScope(token);
    const concrete = scope.organizationId
      ? await fetchNav(request, token, scope.organizationId)
      : null;
    const all = await fetchNav(request, token, ALL_ORGANIZATIONS);
    console.log('[TC-AUTH-NAV-ORG-001] token scope:', JSON.stringify(scope));
    console.log('[TC-AUTH-NAV-ORG-001] concrete currentOrganization:', JSON.stringify(concrete?.currentOrganization ?? null));
    console.log('[TC-AUTH-NAV-ORG-001] all-orgs currentOrganization:', JSON.stringify(all.currentOrganization ?? null));
    // A caller with no home organization cannot exercise the auth.orgId fallback at all.
    expect(
      scope.organizationId,
      'this caller must carry a home organization, otherwise the all-organizations assertions below are vacuous',
    ).toBeTruthy();
  });
  test('names the organization when a concrete one is selected', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);
    const { organizationId } = getTokenScope(token);
    test.skip(!organizationId, 'admin token carries no organization to select');

    const payload = await fetchNav(request, token, organizationId);

    expect(
      payload.currentOrganization,
      'a concrete organization selection should be identified in the payload',
    ).toBeTruthy();
    expect(payload.currentOrganization?.id).toBe(organizationId);
    expect(
      typeof payload.currentOrganization?.name === 'string' && payload.currentOrganization.name.length > 0,
      'the identified organization should carry a non-empty display name',
    ).toBe(true);
  });

  test('reports no organization while viewing all organizations', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);

    const payload = await fetchNav(request, token, ALL_ORGANIZATIONS);

    // The regression: `resolveFeatureCheckContext` falls back to `auth.orgId` here, so a payload
    // built from the resolved id names the home organization even though the operator selected all.
    expect(
      payload.currentOrganization ?? null,
      'an all-organizations selection must not name a single organization',
    ).toBeNull();
  });

  test('does not serve the home-organization payload for an all-organizations request', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);
    const { organizationId } = getTokenScope(token);
    test.skip(!organizationId, 'admin token carries no organization to select');

    // Warm the concrete-selection response first, then ask for all organizations. Both resolve to
    // the same fallback organization id, so a cache key derived only from the resolved scope would
    // hand the concrete payload back here.
    const concrete = await fetchNav(request, token, organizationId);
    expect(concrete.currentOrganization?.id).toBe(organizationId);

    const allOrganizations = await fetchNav(request, token, ALL_ORGANIZATIONS);
    expect(
      allOrganizations.currentOrganization ?? null,
      'the all-organizations payload must be distinct from the cached concrete-selection payload',
    ).toBeNull();

    // And the reverse order, so neither direction of cache reuse can hide the defect.
    const concreteAgain = await fetchNav(request, token, organizationId);
    expect(
      concreteAgain.currentOrganization?.id,
      'the concrete selection must still be identified after an all-organizations request',
    ).toBe(organizationId);
  });

  test('keeps returning a usable nav payload in both scopes', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);
    const { organizationId } = getTokenScope(token);

    for (const selection of [organizationId, ALL_ORGANIZATIONS].filter(Boolean) as string[]) {
      const payload = await fetchNav(request, token, selection);
      expect(Array.isArray(payload.groups), `groups should be present for selection ${selection}`).toBe(true);
    }
  });
});
