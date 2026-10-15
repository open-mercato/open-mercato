import { type Page, expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue';
import { deleteCodeIfExists, uniqueStamp } from './helpers';

const PROMOTIONS_CODE_GENERATE_QUEUE = 'promotions-code-generate';

// `CrudForm` field labels are plain sibling text nodes next to the control, never a
// semantic `<label for>`/`aria-labelledby` association — `getByLabel` hangs forever
// waiting for a match that never resolves (confirmed against this exact page: see the
// lesson this spec's own first failed run recorded). Every field wrapper DOES carry a
// stable `data-crud-field-id` attribute (`CrudForm.tsx`'s `renderField`), so address a
// text/number field through that instead.
function crudTextField(page: Page, fieldId: string) {
  return page.locator(`[data-crud-field-id="${fieldId}"]`).locator('input, textarea').first();
}

/**
 * TC-PROM-083: the codes backend pages (`/backend/codes`, `/backend/codes/create`,
 * `/backend/codes/[id]`, Release 4 PLAN.md Step 6.6) through a real browser session —
 * the first automated test for this UI; Step 6.6's own dispatch only did a manual
 * browser click-through (PLAN.md's own note), never an executable spec.
 *
 * Covers the list → create → detail-edit → delete round trip for a static code, plus
 * the dynamic-code generation action from the detail page, reading `codeFormFields.tsx`'s
 * real field labels rather than guessing selectors.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Backend Routes
 * "Promotional Codes (`/backend/codes`)" + §Implementation Plan Phase 3 step 6.6/6.8.
 */
test.describe('TC-PROM-083: codes backend pages', () => {
  test('create, edit, generate, and delete a promotional code through the real UI', async ({ page, request }) => {
    test.setTimeout(120_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const staticName = `QA PROM 083 Static ${stamp}`;
    const staticCode = `QA-PROM-083-${stamp}`.toUpperCase();
    const renamedStaticName = `QA PROM 083 Static Renamed ${stamp}`;
    const dynamicName = `QA PROM 083 Dynamic ${stamp}`;

    let staticCodeId: string | null = null;
    let dynamicCodeId: string | null = null;

    try {
      await login(page, 'admin');

      // --- Create a static code through the real form ------------------------
      await page.goto('/backend/codes', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Promotional codes' })).toBeVisible();
      await page.getByRole('link', { name: 'Create code' }).click();
      await page.waitForURL('**/backend/codes/create');

      await expect(page.getByRole('heading', { name: 'Create promotional code' })).toBeVisible();
      await crudTextField(page, 'name').fill(staticName);
      // Type defaults to "Static" (the create page's own `initialValues`), so only the
      // Code field needs filling.
      await crudTextField(page, 'code').fill(staticCode);
      await expect(crudTextField(page, 'name')).toHaveValue(staticName);
      await expect(crudTextField(page, 'code')).toHaveValue(staticCode);
      await page.getByRole('button', { name: 'Save code' }).first().click();

      await page.waitForURL('**/backend/codes/**', { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: staticName })).toBeVisible();
      const staticUrl = page.url();
      staticCodeId = staticUrl.split('/backend/codes/')[1]?.split(/[?#]/)[0] ?? null;
      expect(staticCodeId, 'detail page URL must carry the new code id').toBeTruthy();

      // --- It shows up in the list, searchable by name -----------------------
      await page.goto('/backend/codes', { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('Search promotional codes...').fill(staticName);
      await expect(page.getByRole('link', { name: staticName })).toBeVisible();

      // --- Edit it from the detail page ---------------------------------------
      await page.getByRole('link', { name: staticName }).click();
      await page.waitForURL('**/backend/codes/**');
      await crudTextField(page, 'name').fill(renamedStaticName);
      await page.getByRole('button', { name: 'Save code' }).first().click();
      await expect(page.getByText('Promotional code saved')).toBeVisible();
      await expect(page.getByRole('heading', { name: renamedStaticName })).toBeVisible();

      // --- Create a dynamic code and trigger generation from the detail page -
      await page.goto('/backend/codes/create', { waitUntil: 'domcontentloaded' });
      // `type` is a Radix `Select` (`codeFormFields.tsx`), not a native <select> — click
      // its combobox trigger then pick the option, same pattern as
      // `customer_groups/__integration__/TC-CGRP-016-group-create-edit-ui.spec.ts`. Switch
      // the type FIRST — selecting it swaps the visible static/dynamic-only fields
      // (`code` vs `prefix`/`suffix`/`length`/`amount`), so filling text fields afterward
      // avoids racing that layout change.
      const typeField = page.locator('[data-crud-field-id="type"]');
      await typeField.getByRole('combobox').click();
      await page.getByRole('option', { name: 'Dynamic — a generated pool of codes' }).click();
      await crudTextField(page, 'amount').fill('3');
      await crudTextField(page, 'name').fill(dynamicName);
      await expect(crudTextField(page, 'name')).toHaveValue(dynamicName);
      await expect(crudTextField(page, 'amount')).toHaveValue('3');
      await page.getByRole('button', { name: 'Save code' }).first().click();
      await page.waitForURL('**/backend/codes/**', { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: dynamicName })).toBeVisible();
      const dynamicUrl = page.url();
      dynamicCodeId = dynamicUrl.split('/backend/codes/')[1]?.split(/[?#]/)[0] ?? null;
      expect(dynamicCodeId, 'detail page URL must carry the new dynamic code id').toBeTruthy();

      await expect(page.getByRole('heading', { name: 'Generated codes' })).toBeVisible();

      // `commands/codes.ts`'s own create command ALSO fires `triggerGeneration`
      // automatically for a dynamic code (§API Contracts: "for dynamic type, triggers
      // generation worker"), and this environment's lazy-shared worker (armed by
      // `yarn dev:app`) picks the job up for real — often before this detail page even
      // finishes its first load. So the pool may already read 3 / 3 here; only click the
      // explicit "Generate" action (Step 6.6's own second trigger surface) when the pool
      // genuinely still has room, and either way assert the end state by POLLING rather
      // than racing a one-shot flash message against however fast the real worker is.
      const generateButton = page.getByRole('button', { name: 'Generate' });
      if (await generateButton.isVisible().catch(() => false)) {
        await generateButton.click();
      }
      await drainIntegrationQueue(PROMOTIONS_CODE_GENERATE_QUEUE).catch(() => 0);

      // Poll the API directly (`page.request`, same cookie session, no page-level fetch
      // involved) rather than repeatedly reloading the page and re-reading its DOM — a
      // plain `fetch()` GET with no `Cache-Control` response header can be served from
      // the browser's own HTTP cache across a `page.reload()` in this engine, which made
      // an earlier version of this spec poll a stale "0 / 3" DOM forever even though the
      // server-side row had already reached 3 / 3 (confirmed directly against this exact
      // route with `curl` while debugging). Reload the real page only ONCE the API
      // confirms the pool is full, to assert the UI itself reflects it.
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/promotions/codes?ids=${dynamicCodeId}&page=1&pageSize=1`);
            const body = (await response.json().catch(() => null)) as { items?: Array<{ generated?: number; amount?: number }> } | null;
            const item = body?.items?.[0];
            return typeof item?.generated === 'number' && item.generated === item.amount;
          },
          { timeout: 30_000, message: 'pool never reached amount via the API' },
        )
        .toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText(/3 \/ 3/).first()).toBeVisible({ timeout: 10_000 });

      await page.getByRole('button', { name: 'View generated codes' }).click();
      const generatedModal = page.getByRole('dialog');
      await expect(generatedModal).toBeVisible();
      await expect(generatedModal.getByRole('button', { name: 'Copy code' }).first()).toBeVisible();
      await page.keyboard.press('Escape');

      // --- Delete the static code from the list row action -------------------
      await page.goto('/backend/codes', { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('Search promotional codes...').fill(renamedStaticName);
      const staticRow = page.getByRole('row', { name: renamedStaticName });
      await expect(staticRow).toBeVisible();
      await staticRow.getByRole('button', { name: 'Open actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      // `useConfirmDialog`'s own default confirm label ("Confirm") is used here — the
      // page's `confirmDialog(...)` call never overrides `confirmText`.
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(page.getByText('Promotional code deleted')).toBeVisible();
      await expect(page.getByRole('link', { name: renamedStaticName })).toHaveCount(0);
      staticCodeId = null;
    } finally {
      await deleteCodeIfExists(request, token, staticCodeId);
      await deleteCodeIfExists(request, token, dynamicCodeId);
    }
  });
});
