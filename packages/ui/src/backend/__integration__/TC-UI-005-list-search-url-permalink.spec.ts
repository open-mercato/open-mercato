import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createApiKeyFixture } from '@open-mercato/core/helpers/integration/apiKeysFixtures';
import { createRandomCurrencyFixture } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { createStaffTeamMemberFixture } from '@open-mercato/core/helpers/integration/staffFixtures';
import { deleteGeneralEntityIfExists } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-UI-005: List search is a URL permalink on migrated DataTable backend pages (#5525)
 *
 * Opening `/backend/...?search=<stamp>` seeds the search box and the first list request,
 * a reload keeps both, typing writes `?search=` through `router.replace` while preserving
 * unrelated params, and clearing removes `search` from the address bar.
 */
export const integrationMeta = {
  dependsOnModules: ['api_keys', 'currencies', 'staff'],
};

type ListCase = {
  name: string;
  path: string;
  apiPath: string;
  create: (request: APIRequestContext, token: string, label: string) => Promise<string>;
};

const EXTRA_PARAM = 'qa';
const EXTRA_VALUE = 'tc-ui-005';

const listCases: ListCase[] = [
  {
    name: 'api keys',
    path: '/backend/api-keys',
    apiPath: '/api/api_keys/keys',
    create: async (request, token, label) => (await createApiKeyFixture(request, token, label)).id,
  },
  {
    name: 'currencies',
    path: '/backend/currencies',
    apiPath: '/api/currencies/currencies',
    create: async (request, token, label) => (await createRandomCurrencyFixture(request, token, { name: label })).id,
  },
  {
    name: 'staff team members',
    path: '/backend/staff/team-members',
    apiPath: '/api/staff/team-members',
    create: (request, token, label) => createStaffTeamMemberFixture(request, token, { displayName: label }),
  },
];

function readUrlParam(page: Page, key: string): string | null {
  return new URL(page.url()).searchParams.get(key);
}

async function expectOnlyStampedRows(page: Page, stamp: string, visible: string[], hidden: string[]): Promise<void> {
  for (const label of visible) {
    await expect(page.getByRole('row').filter({ hasText: label })).toHaveCount(1);
  }
  for (const label of hidden) {
    await expect(page.getByRole('row').filter({ hasText: label })).toHaveCount(0);
  }
  await expect(page.getByRole('row').filter({ hasText: stamp })).toHaveCount(visible.length);
}

for (const listCase of listCases) {
  test(`TC-UI-005: ${listCase.name} list keeps ?search as a permalink`, async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const stamp = `UI005-${suffix}`;
    const alpha = `${stamp} Alpha`;
    const beta = `${stamp} Beta`;
    const decoy = `Unrelated ${Math.random().toString(36).slice(2, 10)}`;
    const createdIds: string[] = [];
    try {
      for (const label of [alpha, beta, decoy]) {
        createdIds.push(await listCase.create(request, token, label));
      }

      await login(page, 'admin');
      await page.goto(`${listCase.path}?${EXTRA_PARAM}=${EXTRA_VALUE}&search=${encodeURIComponent(stamp)}`);
      const searchBox = page.getByRole('main').getByRole('searchbox').first();

      await expect(searchBox).toHaveValue(stamp);
      await expectOnlyStampedRows(page, stamp, [alpha, beta], [decoy]);
      expect(readUrlParam(page, 'search')).toBe(stamp);

      await page.reload();
      await expect(searchBox).toHaveValue(stamp);
      await expectOnlyStampedRows(page, stamp, [alpha, beta], [decoy]);
      expect(readUrlParam(page, 'search')).toBe(stamp);
      expect(readUrlParam(page, EXTRA_PARAM)).toBe(EXTRA_VALUE);

      await searchBox.fill(alpha);
      await expect.poll(() => readUrlParam(page, 'search')).toBe(alpha);
      expect(readUrlParam(page, EXTRA_PARAM)).toBe(EXTRA_VALUE);
      await expectOnlyStampedRows(page, stamp, [alpha], [beta, decoy]);

      await searchBox.fill('');
      await expect.poll(() => readUrlParam(page, 'search')).toBeNull();
      expect(readUrlParam(page, EXTRA_PARAM)).toBe(EXTRA_VALUE);
      await expect(searchBox).toHaveValue('');
    } finally {
      for (const id of createdIds) {
        await deleteGeneralEntityIfExists(request, token, listCase.apiPath, id);
      }
    }
  });
}
