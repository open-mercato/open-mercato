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

test.describe('TC-ENTITIES-008: Custom Entity Default Restriction Policy Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('should allow setting the default restriction policy and reflect it in the custom entity create form', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Navigate to settings and ensure unchecked/disabled initially
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

    // 2. Go to custom entity creation page and check if "Restrict record access" defaults to unchecked
    await page.goto('/backend/entities/user/create');
    await expect(page.getByText('Create Entity')).toBeVisible();
    await page.getByText('Loading…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const restrictionCheckboxOff = page.locator('[data-crud-field-id="accessRestricted"] button[role="checkbox"]');
    await expect(restrictionCheckboxOff).toBeVisible();
    await expect(restrictionCheckboxOff).toHaveAttribute('aria-checked', 'false');

    // 3. Go back to settings page, enable policy
    await page.goto('/backend/config/settings');
    await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();
    const checkboxToEnable = page.locator('#newEntitiesRestrictedByDefault');
    await expect(checkboxToEnable).toBeVisible();
    await expect(checkboxToEnable).toHaveAttribute('aria-checked', 'false');
    await checkboxToEnable.click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Settings saved').first()).toBeVisible();
    await expect(checkboxToEnable).toHaveAttribute('aria-checked', 'true');

    // 4. Go to custom entity creation page again and check if "Restrict record access" defaults to checked
    await page.goto('/backend/entities/user/create');
    await expect(page.getByText('Create Entity')).toBeVisible();
    await page.getByText('Loading…').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

    const restrictionCheckboxOn = page.locator('[data-crud-field-id="accessRestricted"] button[role="checkbox"]');
    await expect(restrictionCheckboxOn).toBeVisible();
    await expect(restrictionCheckboxOn).toHaveAttribute('aria-checked', 'true');

    // Cleanup: restore policy to false
    await page.goto('/backend/config/settings');
    await expect(page.getByRole('heading', { name: 'Custom Entities' })).toBeVisible();
    const checkboxToCleanup = page.locator('#newEntitiesRestrictedByDefault');
    await expect(checkboxToCleanup).toBeVisible();
    if (await checkboxToCleanup.getAttribute('aria-checked') === 'true') {
      await checkboxToCleanup.click();
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Settings saved').first()).toBeVisible();
    }
  });

  test('should enforce authorization on entities settings API', async ({ request }) => {
    // GET and PUT require authentication
    // Unauthenticated GET should return 401
    const resGetUnauth = await rawRequest(request, 'GET', '/api/entities/entity-settings');
    expect(resGetUnauth.status()).toBe(401);

    // Unauthenticated PUT should return 401
    const resPutUnauth = await rawRequest(request, 'PUT', '/api/entities/entity-settings', {
      newEntitiesRestrictedByDefault: true,
    });
    expect(resPutUnauth.status()).toBe(401);
  });

  test('should allow explicit override of accessRestricted during custom entity creation when default restriction policy is enabled', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    // 1. Get current settings to retrieve current updatedAt
    const getRes = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token });
    const currentSettings = await getRes.json();
    
    // 2. Enable default restriction policy
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
      // 3. Create entity explicitly specifying accessRestricted: false
      const createRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Explicit Override Entity',
        description: 'Test explicit override',
        accessRestricted: false,
      } as any);
      expect(createRes.status()).toBe(200);

      // 4. Verify entity list has accessRestricted: false
      const listRes = await listCustomEntities(request, token);
      const listBody = await listRes.json();
      const entity = listBody.items.find((item: any) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity.accessRestricted).toBe(false);
    } finally {
      // Cleanup
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

    // 1. Get current settings to retrieve current updatedAt
    const getRes = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token });
    const currentSettings = await getRes.json();

    // 2. Enable default restriction policy
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
      // 3. Create custom entity without sending accessRestricted (so it defaults to true)
      const createRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Policy Default Entity',
        description: 'Should default to restricted',
      });
      expect(createRes.status()).toBe(200);

      // 4. Verify it was created as restricted
      let listRes = await listCustomEntities(request, token);
      let listBody = await listRes.json();
      let entity = listBody.items.find((item: any) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity.accessRestricted).toBe(true);

      // 5. Update the entity (label/description) without sending accessRestricted in the body
      const updateRes = await createCustomEntity(request, token, {
        entityId,
        label: 'Policy Default Entity - Updated',
        description: 'Updated without accessRestricted field',
      });
      expect(updateRes.status()).toBe(200);

      // 6. Verify that accessRestricted is still true
      listRes = await listCustomEntities(request, token);
      listBody = await listRes.json();
      entity = listBody.items.find((item: any) => item.entityId === entityId);
      expect(entity).toBeDefined();
      expect(entity.accessRestricted).toBe(true);
    } finally {
      // Cleanup
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
    // Intercept the settings request and return 500
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

  test('should handle concurrent edit conflict (409) on PUT settings', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    // 1. Get current settings and get the updatedAt
    const getRes = await apiRequest(request, 'GET', '/api/entities/entity-settings', { token });
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    const currentUpdatedAt = body.updatedAt;

    // 2. Perform a successful update (User 1)
    const putRes1 = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: {
        newEntitiesRestrictedByDefault: true,
        expectedUpdatedAt: currentUpdatedAt,
      },
    });
    expect(putRes1.status()).toBe(200);
    const body1 = await putRes1.json();
    const newUpdatedAt = body1.updatedAt;

    // 3. Perform a second update using the stale updatedAt (User 2)
    const putRes2 = await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: {
        newEntitiesRestrictedByDefault: false,
        expectedUpdatedAt: currentUpdatedAt, // stale timestamp
      },
    });
    expect(putRes2.status()).toBe(409);
    const body2 = await putRes2.json();
    expect(body2.code).toBe('optimistic_lock_conflict');

    // Cleanup: restore settings
    await apiRequest(request, 'PUT', '/api/entities/entity-settings', {
      token,
      data: {
        newEntitiesRestrictedByDefault: false,
        expectedUpdatedAt: newUpdatedAt,
      },
    });
  });
});
