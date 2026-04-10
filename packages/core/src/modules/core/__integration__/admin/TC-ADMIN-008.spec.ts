import { expect, type Page, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';

function fieldControl(page: Page, fieldId: string) {
  return page.locator(`[data-crud-field-id="${fieldId}"]`).first();
}

async function fillCustomEntityField(page: Page, fieldId: string, value: string): Promise<void> {
  const control = fieldControl(page, fieldId);
  await expect(control).toBeVisible();
  const input = control.locator('input, textarea').first();
  await expect(input).toBeVisible();
  await input.fill(value);
}

async function waitForRecordForm(page: Page, fieldIds: string[]): Promise<void> {
  for (const fieldId of fieldIds) {
    await expect(fieldControl(page, fieldId)).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /create|save/i }).first()).toBeVisible();
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
    const expectedFieldIds = ['location', 'title', 'event_date'];
    let token: string | null = null;
    let recordId: string | null = null;

    try {
      token = await getAuthToken(request, 'superadmin');
      const authToken = token;
      const entityCreateResponse = await apiRequest(request, 'POST', '/api/entities/entities', {
        token: authToken,
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
          token: authToken,
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

      await expect
        .poll(async () => {
          const definitionsResponse = await apiRequest(
            request,
            'GET',
            `/api/entities/definitions?entityId=${encodeURIComponent(entityId)}`,
            { token: authToken },
          );
          if (!definitionsResponse.ok()) return [];
          const definitionsPayload = (await definitionsResponse.json()) as {
            items?: Array<{ key?: string }>;
          };
          return (definitionsPayload.items ?? [])
            .map((item) => String(item.key ?? '').trim())
            .filter(Boolean)
            .sort();
        })
        .toEqual([...expectedFieldIds].sort());

      await login(page, 'superadmin');
      const createRecordResponse = await apiRequest(request, 'POST', '/api/entities/records', {
        token: authToken,
        data: {
          entityId,
          values: {
            location,
            title,
            event_date: '2026-02-14',
          },
        },
      });
      expect(createRecordResponse.ok()).toBeTruthy();
      const createPayload = (await createRecordResponse.json()) as { item?: { recordId?: string } };
      recordId = typeof createPayload.item?.recordId === 'string' ? createPayload.item.recordId : null;
      expect(recordId).toBeTruthy();

      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`, {
        waitUntil: 'domcontentloaded',
      });
      await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
      await expect(page.getByRole('link', { name: 'Create' })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records$`, 'i'));
      await expect(page.getByRole('row', { name: new RegExp(location, 'i') })).toBeVisible();
      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records/${encodeURIComponent(recordId!)}`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records/[^/]+$`, 'i'));
      await page.getByText(/Loading record/i).waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});
      await waitForRecordForm(page, expectedFieldIds);

      await fillCustomEntityField(page, 'title', updatedTitle);
      const updateResponsePromise = page.waitForResponse((response) => {
        return response.request().method() === 'PUT' && response.url().includes('/api/entities/records') && response.ok();
      });
      await page.getByRole('button', { name: 'Save' }).first().click();
      await updateResponsePromise;

      await expect(page).toHaveURL(new RegExp(`/backend/entities/user/${encodeURIComponent(entityId)}/records$`, 'i'));
      await expect
        .poll(async () => {
          const updatedRecordResponse = await apiRequest(
            request,
            'GET',
            `/api/entities/records?entityId=${encodeURIComponent(entityId)}&id=${encodeURIComponent(recordId!)}`,
            { token: authToken },
          );
          if (!updatedRecordResponse.ok()) return null;
          const updatedRecordPayload = (await updatedRecordResponse.json()) as {
            items?: Array<{ id?: string; title?: string }>;
          };
          const updatedRecord = (updatedRecordPayload.items ?? []).find((item) => String(item.id) === recordId);
          return updatedRecord?.title ?? null;
        })
        .toBe(updatedTitle);
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
