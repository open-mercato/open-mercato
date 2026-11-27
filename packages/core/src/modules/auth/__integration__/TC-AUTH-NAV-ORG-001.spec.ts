import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectId, getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

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
  grantedFeatures?: string[];
};

async function createBrandedOrganization(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  input: { name: string; tenantId: string; logoUrl: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/organizations', { token, data: input });
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201);
  const body = await readJsonSafe<{ id?: string }>(response);
  return expectId(body?.id, 'Organization creation response should include id');
}

async function fetchNav(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  orgId: string,
): Promise<NavPayload> {
  const response = await apiRequest(request, 'GET', `${NAV_PATH}?orgId=${encodeURIComponent(orgId)}`, { token });
  expect(response.status(), `GET ${NAV_PATH}?orgId=${orgId} should return 200`).toBe(200);
  return (await readJsonSafe<NavPayload>(response)) ?? {};
}

function requireHomeOrganizationId(token: string): string {
  const { organizationId } = getTokenScope(token);
  expect(
    organizationId,
    'this caller must carry a home organization, otherwise the all-organizations assertions are vacuous',
  ).toBeTruthy();
  return organizationId as string;
}

test.describe('admin nav current organization', () => {
  test('names the organization when a concrete one is selected', async ({ request }) => {
    const token = await getAuthToken(request, ROLE);
    const organizationId = requireHomeOrganizationId(token);

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
    requireHomeOrganizationId(token);

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
    const organizationId = requireHomeOrganizationId(token);

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
    const organizationId = requireHomeOrganizationId(token);

    for (const selection of [organizationId, ALL_ORGANIZATIONS]) {
      const payload = await fetchNav(request, token, selection);
      expect(Array.isArray(payload.groups), `groups should be present for selection ${selection}`).toBe(true);
    }
  });

  /**
   * A role whose organization visibility list is explicitly empty (`organizations: []`) resolves to
   * a deny-all scope. Before the guard in `resolveBackendChromePayload`, the brand lookup fell back
   * to the organization named by the request (or the caller's home organization) and returned its
   * name and logo. Both organizations carry a logo here because `brand` only populates for one.
   */
  test('returns no brand or organization to a caller whose organization scope is empty', async ({ request }) => {
    const superadminToken = await getAuthToken(request, ROLE);
    const { tenantId } = getTokenScope(superadminToken);
    expectId(tenantId, 'Superadmin token should carry the actor tenant');

    const stamp = randomUUID();
    const password = 'StrongSecret123!';
    const email = `qa-tc-auth-nav-org-001-${stamp}@example.com`;
    const grantedFeature = 'api_keys.view';
    let homeOrganizationId: string | null = null;
    let otherOrganizationId: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      homeOrganizationId = await createBrandedOrganization(request, superadminToken, {
        name: `QA TC-AUTH-NAV-ORG-001 Home ${stamp}`,
        tenantId,
        logoUrl: 'https://cdn.example.com/qa-tc-auth-nav-org-001-home.png',
      });
      otherOrganizationId = await createBrandedOrganization(request, superadminToken, {
        name: `QA TC-AUTH-NAV-ORG-001 Other ${stamp}`,
        tenantId,
        logoUrl: 'https://cdn.example.com/qa-tc-auth-nav-org-001-other.png',
      });
      roleId = await createRoleFixture(request, superadminToken, {
        name: `qa-tc-auth-nav-org-001-${stamp}`,
        tenantId,
      });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: [grantedFeature],
        organizations: [],
      });
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: homeOrganizationId,
        roles: [roleId],
        name: 'QA TC-AUTH-NAV-ORG-001 Empty scope',
      });
      const token = await getAuthToken(request, email, password);

      for (const [label, organizationId] of [
        ['another organization', otherOrganizationId],
        ['the home organization', homeOrganizationId],
      ] as const) {
        const payload = await fetchNav(request, token, organizationId);

        // Guards against a vacuous pass: the role grants a feature, so an empty `grantedFeatures`
        // proves the resolver really produced a deny-all scope for this caller.
        expect(
          payload.grantedFeatures ?? [],
          `an empty organization scope should grant no features when ${label} is requested`,
        ).toEqual([]);
        expect(
          payload.brand ?? null,
          `an empty organization scope must not receive the brand of ${label}`,
        ).toBeNull();
        expect(
          payload.currentOrganization ?? null,
          `an empty organization scope must not be told it is viewing ${label}`,
        ).toBeNull();
      }
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, otherOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, homeOrganizationId);
    }
  });
});
