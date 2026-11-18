import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setUserAclVisibility } from '@open-mercato/core/helpers/integration/authFixtures';
import { isStandaloneIntegration } from '@open-mercato/core/helpers/integration/standaloneEnv';

export const integrationMeta = {
  dependsOnModules: ['perspectives', 'customers', 'auth'],
};

type SavedPerspective = { id?: string; name?: string; settings?: Record<string, unknown>; updatedAt?: string };
type SaveResponse = { perspective?: SavedPerspective; code?: string; error?: string };
type StateResponse = { perspectives?: SavedPerspective[] };

async function createView(
  request: APIRequestContext,
  token: string,
  tableId: string,
  name: string,
  settings: Record<string, unknown>,
): Promise<string> {
  const res = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
    token,
    data: { name, settings },
  });
  expect(res.status(), 'fixture view create').toBe(200);
  const body = await readJsonSafe<SaveResponse>(res);
  const id = body?.perspective?.id ?? null;
  expect(typeof id, 'fixture view id').toBe('string');
  return id as string;
}

async function listViews(
  request: APIRequestContext,
  token: string,
  tableId: string,
  name: string,
): Promise<SavedPerspective[]> {
  const res = await apiRequest(request, 'GET', `/api/perspectives/${encodeURIComponent(tableId)}`, { token });
  expect(res.status(), 'load views').toBe(200);
  const body = await readJsonSafe<StateResponse>(res);
  return (body?.perspectives ?? []).filter((view) => view.name === name);
}

async function deleteViews(request: APIRequestContext, token: string, tableId: string, ids: string[]) {
  for (const id of ids) {
    await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${encodeURIComponent(id)}`, { token }).catch(() => {});
  }
}

/**
 * TC-PERSP-UNIQUENESS-002: saving a NEW view under the name of an existing
 * personal view must not overwrite that view.
 *
 * Without `perspectiveId` the save endpoint upserts by name. The Views panel's
 * "New" form and the imperative save-as-new path send `createOnly: true`, so a
 * name collision is rejected with 409 `duplicate_name` instead of silently
 * replacing the existing view's settings. Callers that omit the flag keep the
 * upsert-by-name behaviour.
 */
test.describe('TC-PERSP-UNIQUENESS-002: save-as-new does not overwrite a same-named view', () => {
  test('API: createOnly rejects a taken name and leaves the view intact; upsert without the flag is unchanged', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = `qa-persp-unique-002-${stamp}`;
    const name = `QA Save New ${stamp}`;
    const createdIds: string[] = [];

    try {
      const existingId = await createView(request, token, tableId, name, { pageSize: 20 });
      createdIds.push(existingId);

      const collide = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 50 }, createOnly: true },
      });
      expect(collide.status(), 'create-only with a taken name').toBe(409);
      const collideBody = await readJsonSafe<SaveResponse>(collide);
      expect(collideBody?.code).toBe('duplicate_name');

      const collidePl = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 50 }, createOnly: true },
        headers: { 'Accept-Language': 'pl' },
      });
      expect(collidePl.status(), 'create-only with a taken name, Polish client').toBe(409);
      const collidePlBody = await readJsonSafe<SaveResponse>(collidePl);
      expect(collidePlBody?.code).toBe('duplicate_name');
      expect(collidePlBody?.error, 'translated duplicate_name message').toBe('Widok o tej nazwie już istnieje');

      const afterCollide = await listViews(request, token, tableId, name);
      expect(afterCollide, 'still exactly one view with that name').toHaveLength(1);
      expect(afterCollide[0].id).toBe(existingId);
      expect(afterCollide[0].settings?.pageSize, 'existing settings untouched').toBe(20);

      const upsert = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name, settings: { pageSize: 30 } },
      });
      expect(upsert.status(), 'upsert by name without createOnly').toBe(200);
      const upsertBody = await readJsonSafe<SaveResponse>(upsert);
      expect(upsertBody?.perspective?.id, 'upsert keeps updating the same row').toBe(existingId);
      expect(upsertBody?.perspective?.settings?.pageSize).toBe(30);

      const freshName = `${name} fresh`;
      const fresh = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token,
        data: { name: freshName, settings: { pageSize: 40 }, createOnly: true },
      });
      expect(fresh.status(), 'create-only with a free name').toBe(200);
      const freshBody = await readJsonSafe<SaveResponse>(fresh);
      const freshId = freshBody?.perspective?.id ?? null;
      if (freshId) createdIds.push(freshId);
      expect(typeof freshId).toBe('string');
      expect(freshId).not.toBe(existingId);
    } finally {
      await deleteViews(request, token, tableId, createdIds);
    }
  });

  test('API: foreign, missing and deleted personal ids return404 without changing the owner view', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenContext(token);
    const stamp = Date.now();
    const tableId = `qa-persp-refusal-${stamp}`;
    const name = `Protected view ${stamp}`;
    const email = `qa-persp-refusal-${stamp}@example.com`;
    const password = 'Secret123!';
    let roleId: string | null = null;
    let userId: string | null = null;
    const createdIds: string[] = [];
    try {
      roleId = await createRoleFixture(request, token, { name: `Perspective refusal ${stamp}` });
      userId = await createUserFixture(request, token, { email, password, organizationId, roles: [roleId] });
      await setUserAclVisibility(request, token, { userId, features: ['perspectives.use'], organizations: [organizationId] });
      const actorToken = await getAuthToken(request, email, password);
      const existingId = await createView(request, token, tableId, name, { pageSize: 20 });
      createdIds.push(existingId);
      const before = await listViews(request, token, tableId, name);
      const deletedId = await createView(request, token, tableId, `${name} deleted`, { pageSize: 10 });
      createdIds.push(deletedId);
      const deleted = await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${deletedId}`, { token });
      expect(deleted.status()).toBe(200);

      for (const [perspectiveId, requestToken] of [[existingId, actorToken], [randomUUID(), token], [deletedId, token]]) {
        const refused = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
          token: requestToken,
          data: { perspectiveId, name: `Rejected ${stamp}`, settings: { pageSize: 90 } },
        });
        expect(refused.status()).toBe(404);
        const body = await readJsonSafe<SaveResponse>(refused);
        expect(body?.code).toBe('NOT_FOUND');
        expect(typeof body?.error).toBe('string');
        expect(await listViews(request, token, tableId, name)).toEqual(before);
      }
    } finally {
      await deleteViews(request, token, tableId, createdIds);
      await deleteUserIfExists(request, token, userId);
      await deleteRoleIfExists(request, token, roleId);
    }
  });

  test('UI: the Views panel New form shows a duplicate-name error instead of overwriting', async ({ page, request }) => {
    test.skip(isStandaloneIntegration(), 'Standalone smoke runs omit this monorepo-only Views panel check.');

    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    const tableId = 'customers.people.list';
    const name = `QA TC-PERSP-UNIQUENESS-002 ${stamp}`;
    const createdIds: string[] = [];

    try {
      const existingId = await createView(request, token, tableId, name, { pageSize: 20, searchValue: `keep-${stamp}` });
      createdIds.push(existingId);

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      await page.getByTestId('data-table-open-views-sidebar').first().click();
      await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'New', exact: true }).click();
      const nameInput = page.getByPlaceholder('View name...');
      await nameInput.fill(name);
      await page.getByRole('button', { name: 'Create view' }).click();

      await expect(page.getByText('View with this name already exists')).toBeVisible();
      await expect(nameInput).toHaveValue(name);

      const views = await listViews(request, token, tableId, name);
      expect(views, 'no second view and no overwrite').toHaveLength(1);
      expect(views[0].id).toBe(existingId);
      expect(views[0].settings?.searchValue, 'existing view settings untouched').toBe(`keep-${stamp}`);
      expect(views[0].settings?.pageSize).toBe(20);
    } finally {
      await deleteViews(request, token, tableId, createdIds);
    }
  });

  for (const activateSavedView of [false, true]) {
    test(`UI: name-only rename preserves all settings for ${activateSavedView ? 'an active' : 'a nonactive'} view after duplicate correction and ${activateSavedView ? 'keyboard burst' : 'double-click'}`, async ({ page, request }) => {
      test.skip(isStandaloneIntegration(), 'Standalone smoke runs omit this monorepo-only Views panel check.');

      const token = await getAuthToken(request, 'admin');
      const stamp = randomUUID();
      const tableId = 'customers.people.list';
      const originalName = `QA Rename ${stamp}`;
      const occupiedName = `QA Taken ${stamp}`;
      const correctedName = `QA Corrected ${stamp}`;
      const settings = {
        pageSize: 40,
        columnOrder: ['email', 'name'],
        columnVisibility: { name: true, email: true },
        columnSizing: { name: 240 },
        filters: { v: 2, root: { id: 'saved-root', type: 'group', combinator: 'and', children: [{ id: 'saved-rule', type: 'rule', field: 'name', operator: 'contains', value: 'saved filter' }] } },
        sorting: [{ id: 'name', desc: true }],
        searchValue: `rename-${stamp}`,
      };
      const createdIds: string[] = [];

      try {
        const existingId = await createView(request, token, tableId, originalName, settings);
        createdIds.push(existingId);
        const occupiedId = await createView(request, token, tableId, occupiedName, { pageSize: 10 });
        createdIds.push(occupiedId);
        const before = (await listViews(request, token, tableId, originalName))[0];
        expect(before.settings, 'fixture settings round-trip before rename').toEqual(settings);
        const occupiedBefore = await listViews(request, token, tableId, occupiedName);

        await login(page, 'admin');
        await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
        await page.getByTestId('data-table-open-views-sidebar').first().click();
        await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
        const viewButton = page.locator('[data-active]').getByRole('button', { name: originalName, exact: true });
        if (activateSavedView) {
          await viewButton.click();
          await expect(viewButton).toHaveAttribute('aria-current', 'true');
        } else {
          await expect(viewButton).not.toHaveAttribute('aria-current', 'true');
        }
        await viewButton.locator('..').getByRole('button', { name: 'View options', exact: true }).click();
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        const nameInput = page.locator('input:focus').first();
        await expect(nameInput).toHaveValue(originalName);
        await nameInput.fill(occupiedName);
        await nameInput.press('Control+Enter');
        await expect(nameInput).toHaveValue(occupiedName);
        await expect(page.getByText('View with this name already exists')).toBeVisible();
        expect(await listViews(request, token, tableId, originalName)).toEqual([before]);
        expect(await listViews(request, token, tableId, occupiedName)).toEqual(occupiedBefore);

        await nameInput.fill(correctedName);
        const renameRequests: string[] = [];
        await page.route(`**/api/perspectives/${tableId}`, async (route) => {
          if (route.request().method() === 'POST') {
            renameRequests.push(route.request().postData() ?? '');
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          await route.continue();
        });
        const saveResponse = page.waitForResponse((response) => response.request().method() === 'POST'
          && new URL(response.url()).pathname === `/api/perspectives/${tableId}`);
        if (activateSavedView) {
          await nameInput.press('Control+Enter');
          await nameInput.press('Control+Enter');
        } else {
          await page.getByRole('button', { name: 'Confirm rename', exact: true }).dblclick();
        }
        expect((await saveResponse).status()).toBe(200);
        await expect(page.locator('[data-active]').getByRole('button', { name: correctedName, exact: true })).toBeVisible();
        const after = await listViews(request, token, tableId, correctedName);
        expect(after).toHaveLength(1);
        expect(after[0]).toEqual({ ...before, name: correctedName, updatedAt: expect.any(String) });
        expect(after[0].settings).toEqual(settings);
        expect(await listViews(request, token, tableId, occupiedName)).toEqual(occupiedBefore);
        expect(await listViews(request, token, tableId, originalName)).toEqual([]);
        await page.waitForTimeout(10_000);
        expect(renameRequests, 'one rename intent despite repeated submit').toHaveLength(1);
        await expect(page.getByText('This record was modified by someone else.', { exact: false })).toHaveCount(0);
      } finally {
        await deleteViews(request, token, tableId, createdIds);
      }
    });
  }

});
