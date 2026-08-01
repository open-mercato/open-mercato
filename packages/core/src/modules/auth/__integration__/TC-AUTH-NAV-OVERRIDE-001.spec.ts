import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-NAV-OVERRIDE-001: a `modules.ts` nav-ordering override survives real bootstrap, and role /
 * user sidebar preferences still win over it.
 * Source spec: .ai/specs/2026-07-30-nav-group-order-override-domain.md ("Integration Coverage").
 *
 * The unit coverage for this domain mocks the override accessor on one side and the dispatcher on the
 * other, so it never proves that a declaration in the app's `modules.ts` reaches the hydrated sidebar
 * through a real bootstrap. This does, following the same pattern the repository already uses for the
 * API-route domain (`TC-UMES-022`, where the example app applies a real override so a test can prove
 * it): `apps/mercato/src/modules.ts` applies `nav: { groupOrder: ['example.nav.group'] }` to the
 * `example` entry.
 *
 * Verified-against-source contract:
 * - `overrides.nav.groupOrder` prepends group ids ahead of the built-in `defaultGroupOrder`
 *   (`modules/auth/lib/backendChrome.tsx`, `resolveGroupOrder`), so `example.nav.group` must outrank
 *   `customers.nav.group`, which is first in the shipped list
 * - the override is only a *default*: it is applied beneath role and per-user preferences, which the
 *   payload applies afterwards via `applySidebarPreference`
 */

const NAV_PATH = '/api/auth/admin/nav';
const PREFERENCES_PATH = '/api/auth/sidebar/preferences';
const OVERRIDDEN_GROUP = 'example.nav.group';
const SHIPPED_FIRST_GROUP = 'customers.nav.group';

async function navGroupIds(
  request: Parameters<typeof apiRequest>[0],
  token: string,
): Promise<string[]> {
  const response = await apiRequest(request, 'GET', NAV_PATH, { token });
  expect(response.status(), `GET ${NAV_PATH} should return 200`).toBe(200);
  const payload = (await readJsonSafe<{ groups?: Array<{ id?: string }> }>(response)) ?? {};
  return (payload.groups ?? []).map((group) => group.id ?? '');
}

test.describe('nav group order override', () => {
  test('ranks the app-declared group ahead of the shipped ordering', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const groupIds = await navGroupIds(request, token);
    test.skip(
      !groupIds.includes(OVERRIDDEN_GROUP),
      `${OVERRIDDEN_GROUP} is not present for this caller, so the override cannot be observed`,
    );

    expect(
      groupIds[0],
      `the app declares ${OVERRIDDEN_GROUP} first in overrides.nav.groupOrder, so it must lead the sidebar`,
    ).toBe(OVERRIDDEN_GROUP);

    if (groupIds.includes(SHIPPED_FIRST_GROUP)) {
      expect(
        groupIds.indexOf(OVERRIDDEN_GROUP),
        `${OVERRIDDEN_GROUP} must outrank ${SHIPPED_FIRST_GROUP}, which leads the built-in defaultGroupOrder`,
      ).toBeLessThan(groupIds.indexOf(SHIPPED_FIRST_GROUP));
    }
  });

  test('lets a personal sidebar preference win over the app default', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const baseline = await navGroupIds(request, token);
    test.skip(baseline.length < 2, 'need at least two nav groups to reorder');
    test.skip(baseline[0] !== OVERRIDDEN_GROUP, 'app-level nav override is not in effect for this caller');

    const promoted = baseline.find((id) => id && id !== OVERRIDDEN_GROUP);
    expect(promoted, 'expected another group to promote ahead of the overridden one').toBeTruthy();

    try {
      const saved = await apiRequest(request, 'PUT', PREFERENCES_PATH, {
        token,
        data: { groupOrder: [promoted as string, OVERRIDDEN_GROUP] },
      });
      expect(saved.status(), 'saving a personal sidebar preference should succeed').toBe(200);

      // The nav payload is cached and its invalidation after a preference write is not synchronous
      // with the response, so poll rather than asserting a single read — a bare read here is flaky.
      await expect
        .poll(async () => (await navGroupIds(request, token))[0], {
          message: 'a per-user preference is applied after the module default, so it must win',
        })
        .toBe(promoted);
    } finally {
      // `DELETE` on this route is role-scoped and requires `roleId`; the way to clear a *personal*
      // ordering preference is to save an empty groupOrder, which is what the editor's reset does.
      await apiRequest(request, 'PUT', PREFERENCES_PATH, {
        token,
        data: { groupOrder: [] },
      }).catch(() => undefined);
    }

    await expect
      .poll(async () => (await navGroupIds(request, token))[0], {
        message: 'clearing the personal preference should fall back to the app-declared order',
      })
      .toBe(OVERRIDDEN_GROUP);
  });
});
