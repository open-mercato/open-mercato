import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-031: DataTable Advanced Filter Builder
 * Verifies that the advanced filter builder can add conditions,
 * apply them, and the results are filtered accordingly.
 */
test.describe('TC-CRM-031: DataTable Advanced Filter Builder', () => {
  test('should filter people using advanced filter with contains condition', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let personId: string | null = null;
    const ts = Date.now();
    const uniqueName = `QAFilter TC031${ts}`;

    try {
      token = await getAuthToken(request);

      const createResponse = await apiRequest(request, 'POST', '/api/customers/people', {
        token,
        data: { firstName: 'QAFilter', lastName: `TC031${ts}`, displayName: uniqueName, status: 'active' },
      });
      expect(createResponse.ok(), `Create person failed: ${await createResponse.text()}`).toBeTruthy();
      const body = (await readJsonSafe<{ id?: unknown }>(createResponse)) ?? {};
      personId = typeof body.id === 'string' ? body.id : null;
      expect(personId).toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      const advancedFilterToggle = page.getByRole('button', { name: 'Advanced filters' });
      await expect(advancedFilterToggle).toBeVisible();
      await advancedFilterToggle.click();

      const whereLabel = page.getByText('Where');
      await expect(whereLabel).toBeVisible();

      const fieldSelect = page.locator('select[aria-label="Select field"]').first();
      await fieldSelect.selectOption({ label: 'Name' });

      const operatorSelect = page.locator('select[aria-label="Select operator"]').first();
      await operatorSelect.selectOption('contains');

      const valueInput = page.locator('input[aria-label="Text value"]').first();
      await valueInput.fill(`TC031${ts}`);

      const applyButton = page.getByRole('button', { name: 'Apply' });
      await applyButton.click();

      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

      await expect
        .poll(
          async () => {
            const text = await page.locator('tbody').textContent();
            return text?.includes(`TC031${ts}`) ?? false;
          },
          { timeout: 15000 },
        )
        .toBe(true);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
    }
  });
});
