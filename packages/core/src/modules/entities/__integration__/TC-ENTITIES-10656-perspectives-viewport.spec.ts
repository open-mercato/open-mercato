import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createCustomEntity, deleteCustomEntityIfExists } from './helpers/entitiesApi';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

for (const width of [320, 1280]) {
  test(`TC-ENTITIES-10656: Polish Views controls fit and work with the keyboard at ${width}px`, async ({
    page, request, baseURL,
  }) => {
    test.setTimeout(45_000);
    const token = await getAuthToken(request, 'admin');
    const entityId = `qa:v_${Math.random().toString(36).slice(2, 10)}`;
    const tableId = encodeURIComponent(`data-table:entities.user.records.${entityId}`);
    const viewName = 'SzczegółowyWidokRekordów'.repeat(5);
    let perspectiveId: string | undefined;

    try {
      expect((await createCustomEntity(request, token, { entityId, label: 'Widoki QA' })).ok()).toBe(true);
      const created = await apiRequest(request, 'POST', `/api/perspectives/${tableId}`, {
        token,
        data: { name: viewName, settings: {} },
      });
      expect(created.ok()).toBe(true);
      perspectiveId = (await readJsonSafe<{ perspective?: { id: string } }>(created))?.perspective?.id;
      expect(perspectiveId).toBeTruthy();

      await login(page, 'admin');
      await page.context().addCookies([{ name: 'locale', value: 'pl', url: baseURL ?? page.url() }]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}/records`);

      const sidebar = page.getByRole('button', { name: 'Perspektywy', exact: true });
      const selector = sidebar.locator('..').locator('button[aria-haspopup="dialog"]');
      const expectToolbarFits = async () => {
        await expect.poll(() => sidebar.evaluate((button) => {
          const toolbar = button.parentElement;
          if (!toolbar) throw new Error('Views controls have no toolbar');
          const bounds = toolbar.getBoundingClientRect();
          const viewportWidth = document.documentElement.clientWidth;
          return {
            outsideViewport: Math.max(0, -bounds.left, bounds.right - viewportWidth),
            toolbarOverflow: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            pageOverflow: document.documentElement.scrollWidth - viewportWidth,
          };
        })).toEqual({ outsideViewport: 0, toolbarOverflow: 0, pageOverflow: 0 });
      };

      await expect(sidebar).toBeVisible();
      await expect(selector).toHaveAccessibleName(viewName);
      await sidebar.focus();
      await page.keyboard.press('Enter');
      const savedViews = page.getByRole('heading', { name: 'Zapisane widoki' });
      await expect(savedViews).toBeVisible();
      await page.getByRole('button', { name: 'Zamknij', exact: true }).press('Enter');
      await expect(savedViews).toBeHidden();

      await sidebar.focus();
      await page.keyboard.press('Tab');
      await expect(selector).toBeFocused();
      await page.keyboard.press('Enter');
      const popover = page.getByRole('dialog');
      await popover.getByRole('button', { name: '— Brak widoku —', exact: true }).press('Enter');
      await expect(popover).toBeHidden();
      await expect(selector).toHaveAccessibleName('Wszystkie widoki');
      await expect(selector).toBeFocused();
      await expectToolbarFits();

      await page.keyboard.press('Enter');
      const option = popover.getByRole('button', { name: viewName, exact: true });
      await expect(option).toBeVisible();
      await option.press('Enter');
      await expect(popover).toBeHidden();

      await expect(selector).toHaveAccessibleName(viewName);
      await expect(selector).toBeFocused();
      await expectToolbarFits();
      await expect.poll(() => sidebar.getByText('Perspektywy', { exact: true }).evaluate(
        (label) => label.scrollWidth - label.clientWidth,
      )).toBe(0);
      await page.keyboard.press('Enter');
      await expect(popover).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(selector).toBeFocused();
    } finally {
      if (perspectiveId) {
        await apiRequest(request, 'DELETE', `/api/perspectives/${tableId}/${perspectiveId}`, { token });
      }
      await deleteCustomEntityIfExists(request, token, entityId);
    }
  });
}
