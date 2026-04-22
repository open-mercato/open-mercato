import { expect, test } from '@playwright/test';
import { deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-015: Customer Search and Filter
 * Source: .ai/qa/scenarios/TC-CRM-015-customer-search-filter.md
 */
test.describe('TC-CRM-015: Customer Search and Filter', () => {
  test('should search companies by name/email and filter by status, lifecycle and tag', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let tagId: string | null = null;

    const companyName = `QA TC-CRM-015 Co ${Date.now()}`;
    const companyEmail = `qa.crm015.${Date.now()}@example.com`;
    const companyTag = `qa-filter-${Date.now()}`;

    try {
      token = await getAuthToken(request);

      const createTagResponse = await apiRequest(request, 'POST', '/api/customers/tags', {
        token,
        data: {
          slug: companyTag,
          label: companyTag,
        },
      });
      expect(createTagResponse.ok()).toBeTruthy();
      const createTagBody = (await readJsonSafe<{ id?: unknown; tagId?: unknown }>(createTagResponse)) ?? {};
      tagId =
        typeof createTagBody.id === 'string'
          ? createTagBody.id
          : typeof createTagBody.tagId === 'string'
            ? createTagBody.tagId
            : null;
      expect(tagId, 'Expected created tag id').toBeTruthy();

      const createCompanyResponse = await apiRequest(request, 'POST', '/api/customers/companies', {
        token,
        data: {
          displayName: companyName,
          primaryEmail: companyEmail,
          status: 'active',
          lifecycleStage: 'prospect',
          tags: tagId ? [tagId] : [],
        },
      });
      expect(createCompanyResponse.ok()).toBeTruthy();
      const createCompanyBody = (await readJsonSafe<{
        id?: unknown;
        entityId?: unknown;
        companyId?: unknown;
      }>(createCompanyResponse)) ?? {};
      companyId =
        typeof createCompanyBody.id === 'string'
          ? createCompanyBody.id
          : typeof createCompanyBody.entityId === 'string'
            ? createCompanyBody.entityId
            : typeof createCompanyBody.companyId === 'string'
              ? createCompanyBody.companyId
              : null;
      expect(companyId, 'Expected created company id').toBeTruthy();

      await login(page, 'admin');
      await page.goto('/backend/customers/companies', { waitUntil: 'domcontentloaded' });

      const searchByNameResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies?search=${encodeURIComponent(companyName)}&page=1&pageSize=100`,
        { token },
      );
      expect(searchByNameResponse.ok()).toBeTruthy();
      const searchByNameBody =
        (await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(searchByNameResponse)) ?? {};
      const searchByNameItems = Array.isArray(searchByNameBody.items) ? searchByNameBody.items : [];
      expect(
        searchByNameItems.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === companyId),
      ).toBeTruthy();

      const searchByEmailResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies?emailContains=${encodeURIComponent(companyEmail)}&page=1&pageSize=100`,
        { token },
      );
      expect(searchByEmailResponse.ok()).toBeTruthy();
      const searchByEmailBody =
        (await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(searchByEmailResponse)) ?? {};
      const searchByEmailItems = Array.isArray(searchByEmailBody.items) ? searchByEmailBody.items : [];
      expect(
        searchByEmailItems.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === companyId),
      ).toBeTruthy();

      const filteredListResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/companies?status=active&lifecycleStage=prospect&tagIds=${encodeURIComponent(tagId!)}&page=1&pageSize=100`,
        { token },
      );
      expect(filteredListResponse.ok()).toBeTruthy();
      const filteredListBody =
        (await readJsonSafe<{ items?: Array<{ id?: unknown }> }>(filteredListResponse)) ?? {};
      const filteredListItems = Array.isArray(filteredListBody.items) ? filteredListBody.items : [];
      expect(
        filteredListItems.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === companyId),
      ).toBeTruthy();

      const search = page.getByRole('textbox', { name: /Search companies/i });
      const waitForCompanyInList = async () => {
        await expect
          .poll(
            async () => {
              await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
              return await page.getByRole('link', { name: companyName, exact: true }).count();
            },
            { timeout: 20000 },
          )
          .toBeGreaterThan(0);
      };

      await search.fill('');
      await page.getByRole('button', { name: 'Refresh' }).waitFor();
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await page.getByRole('button', { name: /^Filters/ }).click();
      const filtersDialog = page.getByRole('heading', { name: /^Filter$/i }).locator('xpath=ancestor::div[2]');
      try {
        await expect(filtersDialog.getByRole('combobox').nth(2)).toBeVisible({ timeout: 5000 });
      } catch {
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(filtersDialog.getByRole('combobox').nth(2)).toBeVisible();
      }
      await filtersDialog.getByRole('combobox').nth(0).selectOption({ label: 'Active' });
      await filtersDialog.getByRole('combobox').nth(2).selectOption({ label: 'Prospect' });
      const filterTagInput = filtersDialog.getByPlaceholder('Add tag and press Enter');
      await filterTagInput.fill(companyTag);
      const tagSuggestion = filtersDialog.getByRole('button', { name: companyTag, exact: true });
      await expect(tagSuggestion).toBeVisible();
      await tagSuggestion.click();
      await filtersDialog.getByRole('button', { name: 'Apply' }).first().click();

      await expect(page.getByRole('button', { name: /Status:\s*Active/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Lifecycle stage:\s*Prospect/i })).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(companyTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();

      await waitForCompanyInList();

      await page.getByRole('button', { name: /^Filters/ }).click();
      await filtersDialog.getByRole('button', { name: 'Clear' }).first().click();
      await filtersDialog.getByRole('button', { name: 'Apply' }).first().click();
      await search.fill(companyName);
      await page.waitForTimeout(1200);
      await waitForCompanyInList();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
