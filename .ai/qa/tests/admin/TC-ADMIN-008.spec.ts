import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { apiRequest, getAuthToken } from '../helpers/api';

/**
 * TC-ADMIN-008: Create Custom Entity Record
 * Source: .ai/qa/scenarios/TC-ADMIN-008-custom-entity-record.md
 */
test.describe('TC-ADMIN-008: Create Custom Entity Record', () => {
  test('should create and edit a record for a custom entity', async ({ page, request }) => {
    const stamp = Date.now();
    const entityId = `user:qa_admin_008_${stamp}`;
    const location = `QA Location ${stamp}`;
    const title = `QA Title ${stamp}`;
    const updatedTitle = `${title} Updated`;
    let token: string | null = null;
    let recordId: string | null = null;

    try {
      token = await getAuthToken(request);
      const entityCreateResponse = await apiRequest(request, 'POST', '/api/entities/entities', {
        token,
        data: {
          entityId,
          label: `QA Admin 008 ${stamp}`,
          description: 'Temporary QA entity',
          showInSidebar: false,
        },
      });
      expect(entityCreateResponse.ok()).toBeTruthy();

      const fieldDefinitions = [
        { key: 'location', label: 'Location' },
        { key: 'title', label: 'Title' },
        { key: 'event_date', label: 'Event Date' },
      ];
      for (const field of fieldDefinitions) {
        const definitionResponse = await apiRequest(request, 'POST', '/api/entities/definitions', {
          token,
          data: {
            entityId,
            key: field.key,
            kind: 'text',
            configJson: {
              label: field.label,
              priority: 10,
            },
          },
        });
        expect(definitionResponse.ok()).toBeTruthy();
      }

      await login(page, 'admin');
      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`);

      await expect(page.getByRole('heading', { name: new RegExp(`Records:\\s*${entityId}`, 'i') })).toBeVisible();
      await page.getByRole('link', { name: 'Create' }).click();

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/create$`, 'i'));
      await page.getByRole('textbox', { name: 'Location' }).fill(location);
      await page.getByRole('textbox', { name: 'Title' }).fill(title);
      await page.getByRole('textbox', { name: 'Event Date' }).fill('2026-02-14');
      await page.getByRole('button', { name: 'Save' }).first().click();

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records$`, 'i'));
      await expect(page.getByRole('row', { name: new RegExp(location, 'i') })).toBeVisible();

      await page.getByRole('row', { name: new RegExp(location, 'i') }).click();
      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/[^/]+$`, 'i'));
      recordId =
        page.url().match(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/([^/?#]+)$`, 'i'))?.[1] ??
        null;

      await page.getByRole('textbox', { name: 'Title' }).fill(updatedTitle);
      await page.getByRole('button', { name: 'Save' }).first().click();

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records$`, 'i'));
      await expect(page.getByRole('row', { name: new RegExp(updatedTitle, 'i') })).toBeVisible();
    } finally {
      if (token && recordId) {
        await apiRequest(
          request,
          'DELETE',
          `/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(recordId)}`,
          { token },
        ).catch(() => {});
      }
      if (token) {
        await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token,
          data: { entityId, key: 'event_date' },
        }).catch(() => {});
        await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token,
          data: { entityId, key: 'title' },
        }).catch(() => {});
        await apiRequest(request, 'DELETE', '/api/entities/definitions', {
          token,
          data: { entityId, key: 'location' },
        }).catch(() => {});
        await apiRequest(request, 'DELETE', '/api/entities/entities', {
          token,
          data: { entityId },
        }).catch(() => {});
      }
    }
  });
});
