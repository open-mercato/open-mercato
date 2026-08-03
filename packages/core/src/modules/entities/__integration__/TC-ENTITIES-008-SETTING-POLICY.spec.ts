import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import {
  rawRequest,
  createCustomEntity,
  deleteCustomEntityIfExists,
  listCustomEntities,
  uniqueEntityId,
} from './helpers/entitiesApi';

interface CustomEntityListItem {
  entityId: string;
  source: 'custom' | 'system';
  label: string;
  description?: string;
  labelField?: string;
  defaultEditor?: string;
  showInSidebar: boolean;
  accessRestricted: boolean;
  updatedAt?: string;
}

test.describe('TC-ENTITIES-008: Custom Entity Default Restriction Policy Settings', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await login(page, 'admin');
  });

  test('should allow setting the default restriction policy and reflect it in the custom entity create form', async ({ page }) => {
    test.setTimeout(90000);
    try {
      await page.goto('/backend/config/settings');
      await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();

      const checkbox = page.locator('#newEntitiesRestrictedByDefault');
      await expect(checkbox).toBeVisible();

      const isCheckedInitial = await checkbox.getAttribute('aria-checked');
      if (isCheckedInitial === 'true') {
        await checkbox.click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Settings saved').first()).toBeVisible();
        await expect(checkbox).toHaveAttribute('aria-checked', 'false');
      }

      await page.goto('/backend/entities/user/create');
      await expect(page.getByText('Create Entity')).toBeVisible();
      await page.getByText('Loading…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

      const restrictionCheckboxOff = page.locator('[data-crud-field-id="accessRestricted"] button[role="checkbox"]');
      await expect(restrictionCheckboxOff).toBeVisible();
      await expect(restrictionCheckboxOff).toHaveAttribute('aria-checked', 'false');

      await page.goto('/backend/config/settings');
      await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();
      const checkboxToEnable = page.locator('#newEntitiesRestrictedByDefault');
      await expect(checkboxToEnable).toBeVisible();
      await expect(checkboxToEnable).toHaveAttribute('aria-checked', 'false');
      await checkboxToEnable.click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Settings saved').first()).toBeVisible();
      await expect(checkboxToEnable).toHaveAttribute('aria-checked', 'true');

      await page.goto('/backend/entities/user/create');
      await expect(page.getByText('Create Entity')).toBeVisible();
      await page.getByText('Loading…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

      const restrictionCheckboxOn = page.locator('[data-crud-field-id="accessRestricted"] button[role="checkbox"]');
      await expect(restrictionCheckboxOn).toBeVisible();
      await expect(restrictionCheckboxOn).toHaveAttribute('aria-checked', 'true');
    } finally {
      await page.goto('/backend/config/settings');
      await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();
      const checkboxToCleanup = page.locator('#newEntitiesRestrictedByDefault');
      await expect(checkboxToCleanup).toBeVisible();
      if (await checkboxToCleanup.getAttribute('aria-checked') === 'true') {
        await checkboxToCleanup.click();
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Settings saved').first()).toBeVisible();
      }
    }
  });

  test('should enforce authorization on entities settings API', async ({ request }) => {
    const resGetUnauth = await rawRequest(request, 'GET', '/api/entities/entity-settings');
    expect(resGetUnauth.status()).toBe(401);

    const resPutUnauth = await rawRequest(request, 'PUT', '/api/entities/entity-settings', {
      newEntitiesRestrictedByDefault: true,
    });
    expect(resPutUnauth.status()).toBe(401);
  });

  test('should allow explicit override of accessRestricted during custom entity creation when default restriction policy is enabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const getRes = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token });
    const currentSettings = await getRes.json();
    
    const putRes = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: {
        newEntitiesRestrictedByDefault: true,
        expectedUpdatedAt: currentSettings.updatedAt,
      },
    });
    const putBody = await putRes.json();
    const enabledUpdatedAt = putBody.updatedAt;

    const entityId = uniqueEntityId('explicit_override');
    try {
      const createRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Explicit Override Entity',
        description: 'Test explicit override',
        accessRestricted: false,
      });
      expect(createRes.status()).toBe(200);

      const listRes = await listCustomEntities(request, token);
      const listBody = await listRes.json();
      const entity = (listBody.items as CustomEntityListItem[]).find((item) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity?.accessRestricted).toBe(false);
    } finally {
      await deleteCustomEntityIfExists(request, token, entityId);
      await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
        token,
        data: {
          newEntitiesRestrictedByDefault: currentSettings.newEntitiesRestrictedByDefault,
          expectedUpdatedAt: enabledUpdatedAt,
        },
      });
    }
  });

  test('should preserve accessRestricted value on custom entity update when not explicitly sent in the payload', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const getRes = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token });
    const currentSettings = await getRes.json();

    const putRes = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: {
        newEntitiesRestrictedByDefault: true,
        expectedUpdatedAt: currentSettings.updatedAt,
      },
    });
    const putBody = await putRes.json();
    const enabledUpdatedAt = putBody.updatedAt;

    const entityId = uniqueEntityId('preserve_lock');
    try {
      const createRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Policy Default Entity',
        description: 'Should default to restricted',
      });
      expect(createRes.status()).toBe(200);

      let listRes = await listCustomEntities(request, token);
      let listBody = await listRes.json();
      let entity = (listBody.items as CustomEntityListItem[]).find((item) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity?.accessRestricted).toBe(true);

      const updateRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Policy Default Entity - Updated',
        description: 'Updated without accessRestricted field',
      });
      expect(updateRes.status()).toBe(200);

      listRes = await listCustomEntities(request, token);
      listBody = await listRes.json();
      entity = (listBody.items as CustomEntityListItem[]).find((item) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity?.accessRestricted).toBe(true);
    } finally {
      await deleteCustomEntityIfExists(request, token, entityId);
      await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
        token,
        data: {
          newEntitiesRestrictedByDefault: currentSettings.newEntitiesRestrictedByDefault,
          expectedUpdatedAt: enabledUpdatedAt,
        },
      });
    }
  });

  test('should show a warning toast if settings fail to load on the custom entity create page', async ({ page }) => {
    await page.route('**/api/entities/entity-settings', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });

    await page.goto('/backend/entities/user/create');
    await expect(page.getByText('Could not load default restriction policy; using default').first()).toBeVisible();
  });

  test('should show error toast on save failure', async ({ page }) => {
    await page.goto('/backend/config/settings');
    await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();

    await page.route('**/api/entities/entity-settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' }),
        });
      } else {
        await route.continue();
      }
    });

    const checkbox = page.locator('#newEntitiesRestrictedByDefault');
    await checkbox.click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Failed to save settings').first()).toBeVisible();
  });

  test('should show unified record conflict banner on UI conflict', async ({ page }) => {
    await page.goto('/backend/config/settings');
    await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();

    await page.route('**/api/entities/entity-settings', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'optimistic_lock_conflict',
            error: 'Settings were modified by another user. Please reload.',
            currentUpdatedAt: '2026-07-30T10:00:00.000Z',
            expectedUpdatedAt: '2026-07-30T09:00:00.000Z',
          }),
        });
      } else {
        await route.continue();
      }
    });

    const checkbox = page.locator('#newEntitiesRestrictedByDefault');
    await checkbox.click();
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.locator('[data-testid="record-conflict-banner"]')).toBeVisible();
    await expect(page.getByText('This record was modified by someone else. Refresh and try again.').first()).toBeVisible();
  });

  test('should handle concurrent edit conflict (409) on PUT settings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const seedRes = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: { newEntitiesRestrictedByDefault: false },
    });
    expect(seedRes.status()).toBe(200);
    const seedBody = await seedRes.json();
    const currentUpdatedAt = seedBody.updatedAt;
    expect(currentUpdatedAt).not.toBeNull();

    let newUpdatedAt: string | null = null;
    try {
      const putRes1 = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
        token,
        data: {
          newEntitiesRestrictedByDefault: true,
          expectedUpdatedAt: currentUpdatedAt,
        },
      });
      expect(putRes1.status()).toBe(200);
      const body1 = await putRes1.json();
      newUpdatedAt = body1.updatedAt;
      expect(newUpdatedAt).not.toBeNull();

      const putRes2 = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
        token,
        data: {
          newEntitiesRestrictedByDefault: false,
          expectedUpdatedAt: currentUpdatedAt,
        },
      });
      expect(putRes2.status()).toBe(409);
      const body2 = await putRes2.json();
      expect(body2.code).toBe('optimistic_lock_conflict');
      expect(body2.currentUpdatedAt).toBe(newUpdatedAt);
      expect(body2.expectedUpdatedAt).toBe(currentUpdatedAt);
    } finally {
      if (newUpdatedAt) {
        await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
          token,
          data: {
            newEntitiesRestrictedByDefault: false,
            expectedUpdatedAt: newUpdatedAt,
          },
        });
      }
    }
  });
});
