import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { deleteCustomerGroupIfExists } from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-016: customer group create + edit round-trip through the real
 * admin UI (`/backend/customer-groups/create` → `/backend/customer-groups/{id}/edit`).
 *
 * Source: .ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md
 * Step 1.14 — "group edit with terms" Phase-1 subset: this covers the
 * group's OWN fields (code/name/kind/priority) via `CrudForm`. The terms
 * section on the same edit page is Phase 2 and is covered separately by
 * Step 2.9 — not duplicated here.
 *
 * Drives every field through real `page.fill`/combobox interactions (not API
 * calls) using the exact field ids from
 * `backend/customer-groups/create/page.tsx` / `[id]/edit/page.tsx`
 * (`code`, `name`, `kind`, `priority`), then edits the persisted record and
 * confirms the change survives a fresh page load.
 */
test.describe('TC-CGRP-016: customer group create + edit round-trip via the admin UI', () => {
  test('create via the UI persists all fields, then edit via the UI persists the change', async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const code = `qa-cgrp-016-${stamp}`;
    const name = `QA CGRP 016 ${stamp}`;
    const updatedName = `QA CGRP 016 Updated ${stamp}`;
    const priority = fixturePriority(stamp, 0);

    let groupId: string | null = null;

    try {
      await login(page, 'admin');
      await page.goto('/backend/customer-groups/create', { waitUntil: 'domcontentloaded' });

      const codeInput = page.locator('[data-crud-field-id="code"] input');
      const nameInput = page.locator('[data-crud-field-id="name"] input');
      const priorityInput = page.locator('[data-crud-field-id="priority"] input');

      await codeInput.fill(code);
      await expect(codeInput, 'code value commits to the DOM/React state before continuing').toHaveValue(code);
      await nameInput.fill(name);
      await expect(nameInput, 'name value commits before continuing').toHaveValue(name);

      const kindField = page.locator('[data-crud-field-id="kind"]');
      await kindField.getByRole('combobox').click();
      await page.getByRole('option', { name: 'b2b', exact: true }).click();
      // Wait for the Select's own close/commit cycle to finish (the trigger's
      // visible text switches to the selected option) before the next action —
      // continuing immediately risks racing the Select's internal state update.
      await expect(kindField.getByRole('combobox')).toContainText('b2b');

      await priorityInput.fill(String(priority));
      await expect(priorityInput, 'priority value commits before continuing').toHaveValue(String(priority));

      // Re-verify every field right before submit — the form must not have reset
      // any of them due to an intervening re-render.
      await expect(codeInput).toHaveValue(code);
      await expect(nameInput).toHaveValue(name);

      // CrudForm renders two submit buttons for this form (a sticky-header action
      // bound via `form="<id>"` plus the inline footer button); both submit the
      // same form.
      await page.getByRole('button', { name: 'Create' }).last().click();
      await page.waitForURL(/\/backend\/customer-groups(\?.*)?$/, { timeout: 20_000 });

      // Resolve the id created by the UI via the API (the list route's own
      // `code` filter — `search` is an ILIKE OR across code/name, so an
      // exact-code fixture stamp is unambiguous even alongside concurrent runs).
      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customer_groups/customer-groups?search=${encodeURIComponent(code)}&pageSize=10`,
        { token },
      );
      expect(listResponse.status(), 'list lookup for the UI-created group should be 200').toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse);
      const created = (listBody?.items ?? []).find((item) => item.code === code);
      expect(created, 'the UI-created group should be findable via the API by its code').toBeTruthy();
      groupId = typeof created?.id === 'string' ? created.id : null;
      expect(groupId, 'created group should have an id').toBeTruthy();

      // Every field the form exposed reached the persisted row.
      expect(created?.name).toBe(name);
      expect(created?.kind).toBe('b2b');
      expect(Number(created?.priority)).toBe(priority);

      const createdRow = page.getByRole('row').filter({ hasText: code }).first();
      await expect(createdRow).toBeVisible({ timeout: 15_000 });

      const openActions = createdRow.getByRole('button', { name: /Open actions/i }).first();
      await openActions.click();
      await page.getByRole('menuitem', { name: /Edit/i }).first().click();
      await page.waitForURL(new RegExp(`/backend/customer-groups/${groupId}/edit$`), { timeout: 15_000 });

      const editNameInput = page.locator('[data-crud-field-id="name"] input');
      await expect(editNameInput).toHaveValue(name, { timeout: 15_000 });
      await editNameInput.fill(updatedName);

      await page.getByRole('button', { name: /^Save$/ }).first().click();
      await page.waitForURL(/\/backend\/customer-groups(\?.*)?$/, { timeout: 20_000 });

      // Reload the edit page fresh (not just the optimistic client state) to
      // prove the update round-tripped through the real HTTP response.
      await page.goto(`/backend/customer-groups/${groupId}/edit`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[data-crud-field-id="name"] input')).toHaveValue(updatedName, { timeout: 15_000 });

      const rereadResponse = await apiRequest(request, 'GET', `/api/customer_groups/customer-groups?id=${encodeURIComponent(groupId!)}`, {
        token,
      });
      const rereadBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(rereadResponse);
      expect((rereadBody?.items ?? [])[0]?.name).toBe(updatedName);
    } finally {
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
