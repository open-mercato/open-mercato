import { test, expect, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { waitForApiMutation } from '@open-mercato/core/modules/core/__integration__/helpers/ui';

/**
 * TC-CRM-6442-ui (browser UI) — deal owner assignment driven through the real UI.
 *
 * Spec: .ai/specs/2026-09-24-crm-deal-owner-assignment.md — the four `Integration (UI)` rows
 * of its Test Coverage table: the standalone New deal page (**D11**), the person/company
 * create flow (**D7**), the detail form (**D2**), and the deals list bulk action (**D3**).
 *
 * These exist because the API-level specs could not catch an entire class of defect. Every
 * writing surface in this feature builds its request payload as an explicit **allow-list**, so
 * a field the form collects perfectly can still be dropped before the request is sent. That
 * happened three times during implementation — in `embeddedInitialValues`, in
 * `DealForm.handleSubmit`, and in `DealsSection.handleCreate`, where it shipped as far as code
 * review: the owner picker showed the right person, the save succeeded, and the deal was
 * created unowned.
 *
 * So these tests assert the **request the browser actually sends**, via `waitForApiMutation`,
 * rather than only the state the database ends in. An allow-list that drops `ownerUserId`
 * fails them immediately.
 */

const OWNER_FIELD = '[data-crud-field-id="ownerUserId"]';

async function pickOwnerInScope(page: Page, scope: string, query: string): Promise<void> {
  const root = page.locator(scope);
  const search = root.locator('input[role="combobox"], input[placeholder*="name or email" i]').first();
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.click();
  await search.fill(query);
  const option = root.locator('[role="option"]').filter({ hasText: query }).first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
}

/**
 * The deal detail form lives behind a collapsible panel and, inside it, collapsible groups —
 * so the owner field is simply absent from the DOM until both are opened. Mirrors
 * `revealDisplayNameInput` in TC-LOCK-OSS-014.
 */
async function revealOwnerField(page: Page): Promise<void> {
  // Wait for the detail page itself before hunting for a field inside it: a cold dev-server
  // compile of this route can take the better part of a minute, and without this anchor the
  // field lookup burns its whole budget on a page that has not rendered yet.
  await expect(page.getByRole('button', { name: 'Save' }).first()).toBeVisible({ timeout: 120_000 });

  const ownerField = page.locator(OWNER_FIELD);
  if (await ownerField.isVisible().catch(() => false)) return;

  const expandPanel = page.getByRole('button', { name: /expand form panel/i }).first();
  if (await expandPanel.isVisible().catch(() => false)) {
    await expandPanel.click();
    await page.waitForTimeout(500);
  }
  if (await ownerField.isVisible().catch(() => false)) return;

  // The group itself may be collapsed; its header toggles it.
  const group = page.getByRole('button', { name: /^deal details/i }).first();
  if (await group.isVisible().catch(() => false)) {
    await group.click();
    await page.waitForTimeout(500);
  }
  await expect(ownerField).toBeVisible({ timeout: 90_000 });
}

async function ownerOf(request: Parameters<typeof apiRequest>[0], token: string, dealId: string) {
  const payload = await readJsonSafe(await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token }));
  return (payload as { deal?: { ownerUserId?: string | null } })?.deal?.ownerUserId ?? null;
}

test.describe('CRM deal owner assignment — browser UI', () => {
  // Each test loads a backend route the dev server may still be compiling, so the default
  // 20s budget is not enough for a cold first hit.
  test.setTimeout(120_000);

  const createdDealIds: string[] = [];
  let companyId = '';
  let token = '';

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
    companyId = await createCompanyFixture(request, token, `TC-CRM-6442-ui Co ${Date.now()}`);
  });

  test.afterAll(async ({ request }) => {
    for (const dealId of createdDealIds) {
      await deleteEntityByBody(request, token, '/api/customers/deals', dealId);
    }
    await deleteEntityByBody(request, token, '/api/customers/companies', companyId);
  });

  // D11 + D10: the standalone page carries the owner, defaulted to the current user.
  test('standalone New deal page sends the owner it displays', async ({ page, request }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/deals/create');

    const ownerField = page.locator(OWNER_FIELD);
    await expect(ownerField).toBeVisible({ timeout: 60_000 });
    // D10 — self-assigned before the user touches anything.
    await expect(ownerField.locator('[role="option"][aria-selected="true"]')).toBeVisible({ timeout: 30_000 });

    const title = `TC-CRM-6442-ui standalone ${Date.now()}`;
    await page.locator('input#title, [data-crud-field-id="title"] input').first().fill(title);

    const response = await waitForApiMutation(page, '/api/customers/deals', async () => {
      await page.getByRole('button', { name: 'Create deal' }).first().click();
    }, 'POST', 60_000);

    const sent = JSON.parse(response.request().postData() ?? '{}');
    expect(sent.ownerUserId, 'The create request must carry the owner the form displayed').toBeTruthy();

    const body = await response.json().catch(() => ({}));
    if (typeof (body as { id?: string })?.id === 'string') createdDealIds.push((body as { id: string }).id);
  });

  /**
   * D7 — the regression this whole file exists for. `DealsSection.handleCreate` rebuilt the
   * payload without `ownerUserId`, so this flow created unowned deals while the UI showed an
   * owner. Asserting the POST body is what makes that visible.
   */
  test('person/company Add deal sends the owner it displays', async ({ page }) => {
    await login(page, 'admin');
    await page.goto(`/backend/customers/companies/${companyId}`);

    await page.getByRole('tab', { name: 'Deals' }).click();
    // The section surfaces its add action in more than one place (header and empty state).
    await page.getByRole('button', { name: 'Add deal' }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.locator(OWNER_FIELD)).toBeVisible({ timeout: 45_000 });

    const title = `TC-CRM-6442-ui from company ${Date.now()}`;
    await dialog.locator('[data-crud-field-id="title"] input').first().fill(title);

    const response = await waitForApiMutation(page, '/api/customers/deals', async () => {
      await dialog.getByRole('button', { name: /save|create/i }).first().click();
    }, 'POST', 60_000);

    const sent = JSON.parse(response.request().postData() ?? '{}');
    expect(
      sent,
      'The create payload must include ownerUserId — DealsSection builds it as an allow-list',
    ).toHaveProperty('ownerUserId');
    expect(sent.ownerUserId, 'The displayed owner must not be dropped').toBeTruthy();

    const body = await response.json().catch(() => ({}));
    if (typeof (body as { id?: string })?.id === 'string') createdDealIds.push((body as { id: string }).id);
  });

  // D2 + D5: the detail form both assigns and clears, through its ordinary PUT.
  test('deal detail assigns and then clears the owner', async ({ page, request }) => {
    const dealId = await createDealFixture(request, token, { title: `TC-CRM-6442-ui detail ${Date.now()}` });
    createdDealIds.push(dealId);

    await login(page, 'admin');
    await page.goto(`/backend/customers/deals/${dealId}`);

    await revealOwnerField(page);
    const ownerField = page.locator(OWNER_FIELD);

    await pickOwnerInScope(page, OWNER_FIELD, 'Priya');
    const assign = await waitForApiMutation(page, '/api/customers/deals', async () => {
      await page.getByRole('button', { name: 'Save' }).first().click();
    }, 'PUT', 60_000);
    expect(JSON.parse(assign.request().postData() ?? '{}').ownerUserId).toBeTruthy();
    await expect.poll(() => ownerOf(request, token, dealId), { timeout: 20_000 }).not.toBeNull();

    // D5 — clearing must send an explicit null, not omit the key.
    const clear = ownerField.getByRole('button', { name: /clear selection/i }).first();
    await expect(clear).toBeVisible({ timeout: 20_000 });
    await clear.click();

    const cleared = await waitForApiMutation(page, '/api/customers/deals', async () => {
      await page.getByRole('button', { name: 'Save' }).first().click();
    }, 'PUT', 60_000);
    const clearedBody = JSON.parse(cleared.request().postData() ?? '{}');
    expect(clearedBody).toHaveProperty('ownerUserId');
    expect(clearedBody.ownerUserId, 'Clearing must send null, not omit the key').toBeNull();
    await expect.poll(() => ownerOf(request, token, dealId), { timeout: 20_000 }).toBeNull();
  });

  // D3 — the list bulk action posts the operator's selection to the queued endpoint.
  test('deals list bulk action sends the selected ids and owner', async ({ page, request }) => {
    const dealId = await createDealFixture(request, token, { title: `TC-CRM-6442-ui list ${Date.now()}` });
    createdDealIds.push(dealId);

    await login(page, 'admin');
    await page.goto('/backend/customers/deals');
    await expect(page.getByRole('button', { name: 'Reassign owner' })).toHaveCount(0);

    await page.locator('tbody tr [role="checkbox"], tbody tr input[type="checkbox"]').first().click();

    const reassign = page.getByRole('button', { name: 'Reassign owner' });
    await expect(reassign, 'Selecting rows must reveal the bulk action').toBeVisible({ timeout: 20_000 });
    await reassign.click();

    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: /^Reassign \d+ deals?$/ });
    // D5 — no target chosen means no bulk unassignment.
    await expect(confirm).toBeDisabled();

    await pickOwnerInScope(page, '[role="dialog"]', 'Priya');
    await expect(confirm).toBeEnabled({ timeout: 20_000 });

    const response = await waitForApiMutation(page, '/api/customers/deals/bulk-update-owner', async () => {
      await confirm.click();
    }, 'POST', 60_000);

    const sent = JSON.parse(response.request().postData() ?? '{}');
    expect(Array.isArray(sent.ids) && sent.ids.length > 0, 'The bulk request must carry the selection').toBeTruthy();
    expect(sent.ownerUserId, 'The bulk request must carry a real owner, never null').toBeTruthy();
  });

  /**
   * Regression guard for #6858. The create card's header packed the title, subtitle and both
   * buttons into one row with the actions `shrink-0`, so at phone width the heading column
   * collapsed and broke word by word underneath the Cancel button — visibly worse in locales
   * whose labels are longer than English. Checked in Polish, the locale the issue reported.
   */
  test('create card header does not collide with its actions at phone width', async ({ page, context }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await login(page, 'admin');
    // Must match the config's own baseURL derivation: the ephemeral CI runner serves on
    // 127.0.0.1:<port>, and a cookie pinned to localhost:3000 never applies there — the test
    // would silently run in English and stop guarding the locale the issue reported.
    await context.addCookies([
      { name: 'locale', value: 'pl', url: process.env.BASE_URL || 'http://localhost:3000' },
    ]);
    await page.goto('/backend/customers/deals/create');

    const ownerField = page.locator(OWNER_FIELD);
    await expect(ownerField).toBeVisible({ timeout: 120_000 });

    const card = page.locator('section').filter({ has: page.locator('[data-crud-field-id="title"]') }).first();
    const heading = card.locator('p').first();
    const headingBox = await heading.boundingBox();
    expect(headingBox, 'The card heading must be laid out').not.toBeNull();

    for (const button of await card.locator('button').all()) {
      const box = await button.boundingBox();
      if (!box || !headingBox) continue;
      const overlaps =
        headingBox.x < box.x + box.width &&
        box.x < headingBox.x + headingBox.width &&
        headingBox.y < box.y + box.height &&
        box.y < headingBox.y + headingBox.height;
      expect(overlaps, 'No header action may sit on top of the card heading').toBe(false);
    }

    // The heading collapsing to a sliver is what forced the word-by-word wrap.
    expect(headingBox!.width, 'The heading must keep a usable width').toBeGreaterThan(100);

    const scrollsSideways = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(scrollsSideways, 'A phone-width page must not scroll horizontally').toBe(false);
  });
});
