import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

    const fillField = async (label: string, value: string): Promise<void> => {
      const input = page.getByRole('textbox', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first();
      await expect(input).toBeVisible();
      await input.fill(value);
    };

    const clickSubmit = async (labels: string[]): Promise<void> => {
      for (const label of labels) {
        const button = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first();
        if (await button.isVisible().catch(() => false)) {
          await button.click();
          return;
        }
      }
      throw new Error(`Submit button not found. Tried: ${labels.join(', ')}`);
    };

    try {
      token = await getAuthToken(request, 'superadmin');
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

      await login(page, 'superadmin');
      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`);
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

      await expect(page.getByRole('heading', { name: new RegExp(`Records:\\s*${entityId}`, 'i') })).toBeVisible();
      await page.getByRole('link', { name: 'Create' }).click();

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/create$`, 'i'));
      await fillField('Location', location);
      await fillField('Title', title);
      await fillField('Event Date', '2026-02-14');
      await clickSubmit(['Create', 'Save']);

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records$`, 'i'));
      await expect(page.getByRole('row', { name: new RegExp(location, 'i') })).toBeVisible();

      await page.getByRole('row', { name: new RegExp(location, 'i') }).click();
      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/[^/]+$`, 'i'));
      recordId =
        page.url().match(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/([^/?#]+)$`, 'i'))?.[1] ??
        null;

      await fillField('Title', updatedTitle);
      await clickSubmit(['Save']);

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
