import { expect, test } from '@playwright/test';
import { createCompanyFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-007: Create Deal
 * Source: .ai/qa/scenarios/TC-CRM-007-deal-creation.md
 */
test.describe('TC-CRM-007: Create Deal', () => {
  test('should create a deal with value, probability, close date and company association', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;

    const companyName = `QA TC-CRM-007 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-007 Deal ${Date.now()}`;
    const pipelineName = `QA TC-CRM-007 Pipeline ${Date.now()}`;
    const stageName = 'Opportunity';

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageName, order: 0 });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/create');

      await page.locator('form').getByRole('textbox').first().fill(dealTitle);
      await page.locator('select').filter({ has: page.locator('option', { hasText: 'Open' }) }).first().selectOption({ label: 'Open' });
      await page.locator('select').filter({ has: page.locator('option', { hasText: pipelineName }) }).first().selectOption({ label: pipelineName });
      await page.locator('select').filter({ has: page.locator('option', { hasText: stageName }) }).first().selectOption({ label: stageName });
      await page.getByRole('spinbutton').first().fill('25000');
      await page.locator('select').filter({ has: page.locator('option', { hasText: /USD/i }) }).first().selectOption({ index: 1 });
      await page.getByRole('spinbutton').nth(1).fill('60');
      await page.locator('input[type="date"]').fill('2026-12-31');

      const companySearch = page.getByRole('textbox', { name: /Search companies/i });
      await companySearch.fill(companyName);
      await page.getByRole('button', { name: companyName, exact: true }).click();

      await page.getByRole('button', { name: 'Create deal' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/deals$/i);
      await page.getByRole('textbox', { name: /Search deals/i }).fill(dealTitle);
      const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
      await expect(dealRow).toBeVisible();
      await dealRow.click();

      await expect(page).toHaveURL(/\/backend\/customers\/deals\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(dealTitle, { exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/deals\/([0-9a-f-]{36})$/i);
      dealId = idMatch?.[1] ?? null;
      expect(dealId, 'Expected created deal id in detail URL').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
