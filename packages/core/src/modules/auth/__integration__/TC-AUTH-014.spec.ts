import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-014: Organization Switching
 * Source: .ai/qa/scenarios/TC-AUTH-014-organization-switching.md
 *
 * NOTE: the topbar OrganizationSwitcher was migrated from two native `<select>`
 * elements to a single Popover trigger that opens a list of clickable rows
 * (Vercel/Linear workspace-switcher pattern). See `.ai/specs/2026-05-14-topbar-redesign.md`.
 */
test.describe('TC-AUTH-014: Organization Switching', () => {
  test('should allow switching organization context from the header selector', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/users');

    const orgTrigger = page.getByRole('button', { name: /^Organization:/ });
    await expect(orgTrigger).toBeVisible();

    // Open popover and switch to "All organizations" (when the user can see all)
    await orgTrigger.click();
    const popover = page.getByRole('dialog').or(page.locator('[data-radix-popper-content-wrapper]')).first();
    const allOrgsRow = popover.getByRole('button', { name: /^All organizations$/ });
    if (await allOrgsRow.count() === 0) {
      test.skip(true, 'User cannot view all organizations.');
    }
    await allOrgsRow.click();
    await expect(orgTrigger).toContainText(/All organizations/i);

    // Re-open popover and pick the first concrete organization (skip the All sentinel,
    // the tenant SelectTrigger combobox, the manage link, and disabled rows).
    await orgTrigger.click();
    const orgRows = popover
      .locator('button:not([disabled]):not([aria-disabled="true"]):not([role="combobox"])')
      .filter({ hasNotText: /^All organizations$/ });
    const orgRowCount = await orgRows.count();
    if (orgRowCount === 0) {
      test.skip(true, 'No scoped organizations available to switch to.');
    }
    const firstOrgRow = orgRows.first();
    const orgLabel = (await firstOrgRow.textContent())?.trim() ?? '';
    await firstOrgRow.click();
    if (orgLabel.length > 0) {
      await expect(orgTrigger).toContainText(orgLabel);
    }
  });
});
