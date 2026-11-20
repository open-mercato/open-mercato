import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-SETUP-OVERRIDE-I18N-001: a `modules.ts` setup override does not let a translation-only
 * module registration replace the runtime registry (#7243).
 *
 * `apps/mercato/src/modules.ts` declares an empty `setup` override on the `example` entry only under
 * `OM_INTEGRATION_TEST`, which the ephemeral runner sets for the app. Before the fix, applying that
 * override to the dictionary loader's `{ id, translations }` stubs made `registerModules()` treat a
 * locale batch as a full registration, so every module missing from the batch lost its features and
 * `featurePolicy` denied them to every user, superadmin included, until restart.
 *
 * This is an end-to-end guard, not the discriminating regression: in the monorepo production build this
 * spec does NOT flip on `develop` without the fix (the 403 was not reproduced there). The regression that
 * fails without the fix is the unit test in `packages/shared/src/lib/modules/__tests__/registry.test.ts`
 * ("i18n-only registration with a setup override (#7243)"). This spec proves that, with the setup
 * override active in a real bootstrap, features stay granted and guarded routes stay reachable after a
 * backend page load runs the dictionary loader's `registerModules(localeModules)`.
 *
 * Read-only: it creates no fixtures.
 */

const FEATURE_CHECK_PATH = '/api/auth/feature-check';
const PEOPLE_LIST_PATH = '/api/customers/people?pageSize=1';
const FEATURES = ['example.todos.view', 'customers.people.view'];

type FeatureCheckResponse = { ok?: boolean; granted?: string[] };

async function expectFeaturesGranted(request: APIRequestContext, token: string, phase: string) {
  const response = await apiRequest(request, 'POST', FEATURE_CHECK_PATH, {
    token,
    data: { features: FEATURES },
  });
  expect(response.status(), `${phase}: feature-check should return 200`).toBe(200);
  const payload = (await readJsonSafe<FeatureCheckResponse>(response)) ?? {};
  expect(payload.ok, `${phase}: superadmin should hold every probed feature`).toBe(true);
  expect(payload.granted ?? [], `${phase}: every probed feature should be granted`).toEqual(
    expect.arrayContaining(FEATURES),
  );
}

async function expectPeopleListReachable(request: APIRequestContext, token: string, phase: string) {
  const response = await apiRequest(request, 'GET', PEOPLE_LIST_PATH, { token });
  expect(response.status(), `${phase}: GET ${PEOPLE_LIST_PATH} should return 200`).toBe(200);
}

test.describe('TC-AUTH-SETUP-OVERRIDE-I18N-001: setup override survives locale-only registration', () => {
  test('keeps features granted after the dictionary loader re-registers translations', async ({ page, request }) => {
    const token = await getAuthToken(request, 'superadmin');

    await expectFeaturesGranted(request, token, 'before locale registration');
    await expectPeopleListReachable(request, token, 'before locale registration');

    await login(page, 'superadmin');
    await page.goto('/backend/customers/people');
    await expect(page).toHaveURL(/\/backend\/customers\/people/);

    await expectFeaturesGranted(request, token, 'after locale registration');
    await expectPeopleListReachable(request, token, 'after locale registration');
  });
});
