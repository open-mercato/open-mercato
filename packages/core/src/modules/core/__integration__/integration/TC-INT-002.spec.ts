import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/helpers/integration/crmFixtures';
import { createSalesDocument } from '@open-mercato/core/helpers/integration/salesUi';

/**
 * TC-INT-002: Customer to Deal to Quote to Order Flow
 * Source: .ai/qa/scenarios/TC-INT-002-customer-deal-order-flow.md
 */
test.describe('TC-INT-002: Customer to Deal to Quote to Order Flow', () => {
  // Multi-step flow (company → person → deal → order) with multiple Radix Select
  // dropdowns that load options from /api/customers/dictionaries/* and /pipelines.
  // Under CI shard 6 parallel load each navigation + dropdown can take longer
  // than the default 20s, so extend the per-test budget. See ac37d013d for the
  // matching TC-MSG-009 pattern.
  test.setTimeout(180_000);

  test('should create CRM records and open a sales order flow', async ({ page, request }) => {
    const stamp = Date.now();
    const companyName = `QA INT-002 Co ${stamp}`;
    const personFirst = `QA${stamp}`;
    const personLast = 'IntFlow';
    const dealTitle = `QA INT-002 Deal ${stamp}`;
    const pipelineName = `QA INT-002 Pipeline ${stamp}`;
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;

    try {
      token = await getAuthToken(request);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Opportunity', order: 0 });
      await login(page, 'admin');

      await page.goto('/backend/customers/companies/create');
      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.locator('form').getByRole('button', { name: /Create Company/i }).click();
      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      companyId = page.url().match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i)?.[1] ?? null;

      await page.goto('/backend/customers/people/create');
      await page.locator('form').getByRole('textbox').first().fill(personFirst);
      await page.locator('form').getByRole('textbox').nth(1).fill(personLast);
      await page.getByPlaceholder('name@example.com').fill(`qa-int-002-${stamp}@example.com`);
      await page.getByPlaceholder('+00 000 000 000').fill('+1 555 010 0020');
      // Radix Select via CrudForm: target by data-crud-field-id then click option from portal
      const selectByFieldId = async (fieldId: string, label: string | RegExp, exact = true) => {
        const trigger = page.locator(`[data-crud-field-id="${fieldId}"] [role="combobox"]`).first();
        await expect(trigger).toBeEnabled({ timeout: 30_000 });
        await trigger.click();
        const opt = typeof label === 'string'
          ? page.getByRole('option', { name: label, exact })
          : page.getByRole('option', { name: label });
        await expect(opt.first()).toBeVisible({ timeout: 30_000 });
        await opt.first().click();
      }
      await selectByFieldId('companyEntityId', companyName)
      await page.getByRole('button', { name: 'Create Person' }).first().click();
      await expect(page).toHaveURL(/\/backend\/customers\/people-v2\/[0-9a-f-]{36}$/i);
      personId = page.url().match(/\/backend\/customers\/people-v2\/([0-9a-f-]{36})$/i)?.[1] ?? null;

      await page.goto('/backend/customers/deals/create');

      // Wait for dictionary-driven dropdowns to finish loading before any user
      // input. Race avoidance: a late dictionary load can re-trigger
      // CrudForm's initialValues merge that clobbers already-typed `title`.
      await expect(page.locator('[data-crud-field-id="status"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('[data-crud-field-id="valueCurrency"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('[data-crud-field-id="pipelineId"] [role="combobox"]').first()).toBeEnabled({ timeout: 30_000 });

      const dealTitleInput = page.locator('form').getByRole('textbox').first();
      await dealTitleInput.fill(dealTitle);
      await expect(dealTitleInput).toHaveValue(dealTitle, { timeout: 10_000 });
      await selectByFieldId('status', 'Open')
      await selectByFieldId('pipelineId', pipelineName)
      // Opportunity stage isn't seeded for the freshly created pipeline; skip pipelineStageId
      // Deal value + Probability use SuffixInput (currency/% adornments) — both render as
      // textbox with placeholder "0", not spinbutton. The only spinbutton on the page is the
      // "Estimated seats/licenses" custom field, so getByRole('spinbutton') would target that
      // instead. Match the TC-CRM-071 selector pattern.
      await page.getByPlaceholder('0').first().fill('10000');
      await selectByFieldId('valueCurrency', /USD/i, false)
      await page.getByPlaceholder('0').nth(1).fill('50');
      // Expected close date: skipped — DS v3 migrated CrudForm type='date' to
      // a DatePicker button + Popover (no more native <input type="date">),
      // and expectedCloseAt is optional server-side, so the deal still saves
      // and the redirect / list assertions downstream still pass.
      // DealAssociationsField pairs the Companies <Label> with a search input whose accessible
      // name resolves to "Companies" (from the label) — not "Search companies" (which only
      // lives in the placeholder). Target the placeholder directly, mirroring TC-CRM-071.
      await page.getByPlaceholder('Search companies by name or domain…').fill(companyName);
      await page.getByRole('button', { name: companyName, exact: true }).click();

      // Final guard: re-assert title before submit. If a late dictionary load
      // re-merged initialValues mid-test and cleared the value, refill it
      // here so the next submit succeeds rather than failing validation.
      const submitTitleValue = await dealTitleInput.inputValue();
      if (submitTitleValue !== dealTitle) {
        await dealTitleInput.fill(dealTitle);
        await expect(dealTitleInput).toHaveValue(dealTitle, { timeout: 10_000 });
      }

      await page.getByRole('button', { name: 'Create deal' }).first().click();
      await expect(page).toHaveURL(/\/backend\/customers\/deals$/i, { timeout: 30_000 });

      await page.getByPlaceholder(/Search by title/i).fill(dealTitle);
      const dealRow = page.locator('tr').filter({ has: page.getByText(dealTitle, { exact: true }) }).first();
      await expect(dealRow).toBeVisible({ timeout: 30_000 });
      // The deals list re-renders as the debounced search settles, so a click
      // can land on a row that is replaced before navigation registers (the URL
      // stays on the filtered list). Retry the click until the detail route is
      // reached instead of asserting once on a single, possibly-stale click.
      await expect(async () => {
        await dealRow.getByText(dealTitle, { exact: true }).click();
        await expect(page).toHaveURL(/\/backend\/customers\/deals\/[0-9a-f-]{36}$/i, { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      dealId = page.url().match(/\/backend\/customers\/deals\/([0-9a-f-]{36})$/i)?.[1] ?? null;

      await createSalesDocument(page, { kind: 'order', customerQuery: companyName, preferApi: true, token });
      await expect(page).toHaveURL(/kind=order$/i);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
