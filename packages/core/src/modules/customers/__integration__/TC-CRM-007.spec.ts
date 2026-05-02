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
    // Multiple Radix Select dropdowns that load options from /api/customers/dictionaries/*
    // and /api/customers/pipelines on mount; under CI shard 6 parallel load each
    // dropdown can take longer than the 20s default to enable, and a clobbered
    // CrudForm initialValues effect can clear `title` mid-test if we proceed
    // before status options have committed. Extend the budget and gate every
    // interactive control with toBeVisible/toBeEnabled (Maciej-pattern, see
    // commit ac37d013d for TC-MSG-009).
    test.setTimeout(120_000);

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

      // Wait for all dictionary-driven dropdowns to finish loading before any
      // user input. Radix Select renders the trigger as `disabled` while the
      // options promise is pending (DictionaryEntrySelect.loading), and a late
      // resolve can re-trigger CrudForm's initialValues merge that clobbers
      // already-typed values like `title`.
      await expect(page.locator('[data-crud-field-id="status"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('[data-crud-field-id="valueCurrency"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('[data-crud-field-id="pipelineId"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });

      const titleInput = page.locator('form').getByRole('textbox').first();
      await titleInput.fill(dealTitle);
      await expect(titleInput).toHaveValue(dealTitle, { timeout: 10_000 });

      // Radix Select via CrudForm: target by data-crud-field-id
      const selectByFieldId = async (fieldId: string, label: string | RegExp, exact = true) => {
        const trigger = page.locator(`[data-crud-field-id="${fieldId}"] [role="combobox"]`).first();
        await expect(trigger).toBeEnabled({ timeout: 30_000 });
        await trigger.click();
        const opt = typeof label === 'string'
          ? page.getByRole('option', { name: label, exact })
          : page.getByRole('option', { name: label });
        await expect(opt.first()).toBeVisible({ timeout: 10_000 });
        await opt.first().click();
      }
      await selectByFieldId('status', 'Open')
      await selectByFieldId('pipelineId', pipelineName)
      await selectByFieldId('pipelineStageId', stageName)
      await page.getByRole('spinbutton').first().fill('25000');
      await selectByFieldId('valueCurrency', /USD/i, false)
      await page.getByRole('spinbutton').nth(1).fill('60');
      await page.locator('input[type="date"]').fill('2026-12-31');

      const companySearch = page.getByRole('textbox', { name: /Search companies/i });
      await companySearch.fill(companyName);
      await page.getByRole('button', { name: companyName, exact: true }).click();

      // Final guard: re-assert title before submit. If a late dictionary load
      // re-merged initialValues mid-test and cleared the value, refill it
      // here so the next submit succeeds rather than failing validation.
      const submitTitleValue = await titleInput.inputValue();
      if (submitTitleValue !== dealTitle) {
        await titleInput.fill(dealTitle);
        await expect(titleInput).toHaveValue(dealTitle, { timeout: 10_000 });
      }

      await page.getByRole('button', { name: 'Create deal' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/deals$/i, { timeout: 30_000 });
      await page.getByPlaceholder(/Search by title/i).fill(dealTitle);
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
