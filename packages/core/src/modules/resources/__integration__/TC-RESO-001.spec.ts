import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

export const integrationMeta = {
  dependsOnModules: ['resources'],
}

/**
 * TC-RESO-001: Resources list page — renders table, shows created resource, supports navigation to detail
 */
test.describe('TC-RESO-001: Resources list page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('should render the resources table and allow navigating to a resource detail page', async ({ page, request }) => {
    const stamp = Date.now();
    const resourceName = `QA Resource ${stamp}`;

    let token: string | null = null;
    let resourceId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/resources/resources', {
        token,
        data: { name: resourceName, isActive: true },
      });
      expect(createResponse.ok(), 'Resource fixture should be created').toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      resourceId = typeof createBody.id === 'string' ? createBody.id : null;
      expect(resourceId, 'Resource id should be returned by create response').toBeTruthy();

      await page.goto('/backend/resources/resources');

      await expect(
        page.getByRole('heading', { name: /^resources$/i }),
      ).toBeVisible();

      await expect(
        page.getByRole('link', { name: /new resource/i }).or(
          page.getByRole('button', { name: /new resource/i }),
        ),
      ).toBeVisible();

      await expect(page.getByText(resourceName)).toBeVisible();

      await page.goto(`/backend/resources/resources/${encodeURIComponent(resourceId ?? '')}`);

      await expect(
        page.locator('[data-crud-field-id="name"]').getByRole('textbox'),
      ).toHaveValue(resourceName);
    } finally {
      if (token && resourceId) {
        await apiRequest(request, 'DELETE', `/api/resources/resources?id=${encodeURIComponent(resourceId)}`, {
          token,
        }).catch(() => {});
      }
    }
  });
});
