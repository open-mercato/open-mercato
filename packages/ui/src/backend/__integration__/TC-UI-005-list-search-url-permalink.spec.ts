import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createApiKeyFixture } from '@open-mercato/core/helpers/integration/apiKeysFixtures';
import { createRandomCurrencyFixture } from '@open-mercato/core/helpers/integration/currenciesFixtures';
import { createStaffTeamFixture, createStaffTeamMemberFixture } from '@open-mercato/core/helpers/integration/staffFixtures';
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

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

test('TC-UI-005: clearing Team Members filters keeps the current search', async ({ page, request }) => {
  test.slow();
  const token = await getAuthToken(request, 'admin');
  const stamp = `UI005-Filters-${Date.now()}`;
  const teamId = await createStaffTeamFixture(request, token, `Filter team ${Date.now()}`);
  const memberIds: string[] = [];
  const matchingMember = `${stamp} Alpha`;
  const otherMember = `${stamp} Beta`;

  try {
    for (const displayName of [matchingMember, otherMember]) {
      const response = await apiRequest(request, 'POST', '/api/staff/team-members', {
        token,
        data: { teamId, displayName },
      });
      expect(response.ok()).toBeTruthy();
      const body = await readJsonSafe<{ id?: string }>(response);
      memberIds.push(expectId(body?.id, 'Missing staff member fixture ID'));
    }

    await login(page, 'admin');
    const params = new URLSearchParams({ teamId, search: stamp });
    await page.goto(`/backend/staff/team-members?${params.toString()}`);
    const main = page.getByRole('main');
    const searchBox = main.getByRole('searchbox').first();

    await expect(searchBox).toHaveValue(stamp);
    await expectOnlyStampedRows(page, stamp, [matchingMember, otherMember], []);
    await searchBox.fill(matchingMember);
    await expect.poll(() => readUrlParam(page, 'search')).toBe(matchingMember);

    await main.getByRole('button', { name: /^Filters/ }).first().click();
    await page.getByRole('button', { name: 'Clear', exact: true }).first().click();
    await expect.poll(() => readUrlParam(page, 'teamId')).toBeNull();
    expect(readUrlParam(page, 'search')).toBe(matchingMember);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(searchBox).toHaveValue(matchingMember);
    await expectOnlyStampedRows(page, stamp, [matchingMember], [otherMember]);
  } finally {
    for (const id of memberIds) {
      await deleteGeneralEntityIfExists(request, token, '/api/staff/team-members', id);
    }
    await deleteGeneralEntityIfExists(request, token, '/api/staff/teams', teamId);
  }
});
