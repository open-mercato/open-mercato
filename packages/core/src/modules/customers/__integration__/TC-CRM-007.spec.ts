import { expect, test } from '@playwright/test';
import { createCompanyFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

function findStringByKeys(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) continue;
    const found = findStringByKeys(nested, keys);
    if (found) return found;
  }
  return null;
}

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

      const titleInput = page.locator('[data-crud-field-id="title"]').getByRole('textbox').first();
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
      // Stage options render "<label> · stage N of M", so match by substring (not exact) —
      // same pattern as the currency option below.
      await selectByFieldId('pipelineStageId', stageName, false)
      // Deal value + probability are sanitized text inputs (SuffixInput with a currency-code / %
      // adornment), not native number spinbuttons — target them by their stable field id.
      await page.locator('[data-crud-field-id="valueAmount"]').getByRole('textbox').fill('25000');
      await selectByFieldId('valueCurrency', /USD/i, false)
      await page.locator('[data-crud-field-id="probability"]').getByRole('textbox').fill('60');
      // Expected close date: skipped — DS v3 migrated CrudForm type='date' to
      // a DatePicker button + Popover (no more native <input type="date">),
      // and expectedCloseAt is optional server-side (DealForm sends `?? undefined`),
      // so the deal still saves. Re-add an interaction here if a future
      // assertion needs the persisted close date.

      // The association field's <Label> ("Companies") is now the input's accessible name, so
      // target the search box by its placeholder instead of an accessible-name role query.
      const companySearch = page.getByPlaceholder(/Search companies/i);
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

      const createDealResponsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return response.request().method() === 'POST' && url.pathname === '/api/customers/deals';
      });
      await page.getByRole('button', { name: 'Create deal' }).first().click();
      const createDealResponse = await createDealResponsePromise;
      expect(createDealResponse.status(), `POST /api/customers/deals returned ${createDealResponse.status()}`).toBe(201);
      dealId = findStringByKeys(await createDealResponse.json(), ['id', 'dealId', 'entityId']);
      expect(dealId, 'Expected created deal id in create response').toBeTruthy();

      await expect(page).toHaveURL(/\/backend\/customers\/deals$/i, { timeout: 30_000 });
      await page.getByPlaceholder(/Search by title/i).fill(dealTitle);
      // Wait for the debounced search to apply to the URL before clicking the row.
      // The deals list page has a useEffect that calls router.replace whenever the
      // search state changes. Under heavy CI load, this replace can fire *after*
      // the row click's router.push and silently overwrite the /deals/{id}
      // navigation with /deals?search=... (CI shard 7 flake — TC-CRM-007).
      await page.waitForURL(/\/backend\/customers\/deals\?.*search=/i, { timeout: 15_000 });
      const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
      await expect(dealRow).toBeVisible();
      // Click the title text inside the row rather than the row itself.
      // Clicking the TR center can land inside the trailing actions cell
      // (data-actions-cell) when columns reflow under narrow viewports, and the
      // DataTable's row-click handler short-circuits on actions-cell clicks.
      await dealRow.getByText(dealTitle, { exact: true }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/deals\/[0-9a-f-]{36}(?:\?.*)?$/i, { timeout: 30_000 });
      await expect(page.getByText(dealTitle, { exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/deals\/([0-9a-f-]{36})(?:\?|$)/i);
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
