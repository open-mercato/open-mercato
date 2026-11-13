import { expect, test, type Locator, type Page } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createCompanyFixture, createDealFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-7495: the Link deals modal footer keeps its horizontal inset (#7495).
 *
 * `LinkEntityDialog` mounts `DialogContent` with `p-0` + `overflow-hidden` and
 * paints its own `px-6` header/footer. The shared `DialogFooter` default adds
 * `-mx-6` to escape the usual `p-6` padding, which in this zero-padding host
 * pushed the footer 24px past both edges; the clipped overflow swallowed the
 * footer's own inset so the selected count and the primary action sat flush
 * with the modal edges. The footer now opts out of that rule, so both ends must
 * keep a DS inset (`px-6` = 24px) inside the dialog bounds, at desktop width
 * and on the narrow bottom-sheet variant.
 */
const DIALOG_FOOTER = 'xpath=ancestor::*[@data-slot="dialog-footer"][1]';
const MIN_INSET_PX = 16;

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  return box!;
}

async function expectFooterInset(page: Page, dialog: Locator, label: string) {
  const footer = dialog.getByRole('button', { name: 'Cancel', exact: true }).locator(DIALOG_FOOTER);
  const count = footer.getByText(/\d+ deals? selected/);
  const linkButton = footer.getByRole('button', { name: /^Link deal/ });
  await expect(count).toBeVisible();
  await expect(linkButton).toBeVisible();

  const [dialogBox, footerBox, countBox, buttonBox] = await Promise.all([
    boxOf(dialog, 'dialog'),
    boxOf(footer, 'footer'),
    boxOf(count, 'selected count'),
    boxOf(linkButton, 'Link deal button'),
  ]);
  const dialogRight = dialogBox.x + dialogBox.width;

  // The footer spans the dialog but never crosses its edges.
  expect(footerBox.x, `${label}: footer left edge inside the dialog`).toBeGreaterThanOrEqual(dialogBox.x - 1);
  expect(footerBox.x + footerBox.width, `${label}: footer right edge inside the dialog`).toBeLessThanOrEqual(dialogRight + 1);
  expect(Math.abs(footerBox.width - dialogBox.width), `${label}: footer spans the dialog width`).toBeLessThanOrEqual(2);

  // Both ends keep a visible design-system inset.
  expect(countBox.x - dialogBox.x, `${label}: selected count inset from the left edge`).toBeGreaterThanOrEqual(MIN_INSET_PX);
  expect(dialogRight - (buttonBox.x + buttonBox.width), `${label}: Link deal inset from the right edge`).toBeGreaterThanOrEqual(MIN_INSET_PX);
  expect(buttonBox.x + buttonBox.width, `${label}: Link deal stays inside the dialog`).toBeLessThanOrEqual(dialogRight - 1);

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(0);
}

async function openLinkDealsDialog(page: Page, companyId: string, dealTitle: string) {
  await page.goto(`/backend/customers/companies-v2/${companyId}?tab=deals`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab', { name: /^deals/i })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Link existing deal' }).click();
  const dialog = page.getByRole('dialog', { name: /^Link deal/ });
  await expect(dialog).toBeVisible();

  // Search rows are `role=button` toggles with `aria-pressed`; select the fixture deal.
  await dialog.getByPlaceholder(/search all deals/i).fill(dealTitle);
  const row = dialog.getByRole('button', { name: new RegExp(dealTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  return dialog;
}

test.describe('TC-CRM-7495: Link deals modal footer inset', () => {
  test('selected count and Link deal keep their horizontal inset inside the modal', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    const dealTitle = `QA Link Footer Deal ${stamp}`;
    let adminToken: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, adminToken, `QA Link Footer Company ${stamp}`);
      dealId = await createDealFixture(request, adminToken, { title: dealTitle });

      await login(page, 'admin');

      // Desktop width: centered modal.
      await page.setViewportSize({ width: 1280, height: 900 });
      const desktopDialog = await openLinkDealsDialog(page, companyId, dealTitle);
      await expectFooterInset(page, desktopDialog, 'desktop');
      const desktopLink = desktopDialog.getByRole('button', { name: /^Link deal/ });
      await expect(desktopLink).toBeEnabled();
      await page.keyboard.press('Escape');
      await expect(desktopDialog).toBeHidden();

      // Narrow width: bottom-sheet variant must keep the same inset without clipping.
      await page.setViewportSize({ width: 480, height: 860 });
      const narrowDialog = await openLinkDealsDialog(page, companyId, dealTitle);
      await expectFooterInset(page, narrowDialog, 'narrow');
      await narrowDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(narrowDialog).toBeHidden();
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });
});
