import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-INT-008: Availability Rulesets list page — renders table, shows created schedule, supports navigation to detail
 */
test.describe('TC-INT-008: Availability Rulesets list page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('should render the availability schedules table and allow navigating to a ruleset detail page', async ({ page, request }) => {
    const stamp = Date.now();
    const scheduleName = `QA Schedule ${stamp}`;

    let token: string | null = null;
    let rulesetId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/planner/availability-rule-sets', {
        token,
        data: { name: scheduleName, timezone: 'UTC' },
      });
      expect(createResponse.ok(), 'Availability ruleset fixture should be created').toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      rulesetId = typeof createBody.id === 'string' ? createBody.id : null;
      expect(rulesetId, 'Ruleset id should be returned by create response').toBeTruthy();

      await page.goto('/backend/planner/availability-rulesets');

      await expect(
        page.getByRole('heading', { name: /availability schedules/i }),
      ).toBeVisible();

      await expect(
        page.getByRole('link', { name: /new schedule/i }).or(
          page.getByRole('button', { name: /new schedule/i }),
        ),
      ).toBeVisible();

      await expect(page.getByText(scheduleName)).toBeVisible();

      await page.goto(`/backend/planner/availability-rulesets/${encodeURIComponent(rulesetId ?? '')}`);

      await expect(
        page.locator('[data-crud-field-id="name"]').getByRole('textbox'),
      ).toHaveValue(scheduleName);
    } finally {
      if (token && rulesetId) {
        await apiRequest(request, 'DELETE', `/api/planner/availability-rule-sets?id=${encodeURIComponent(rulesetId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
