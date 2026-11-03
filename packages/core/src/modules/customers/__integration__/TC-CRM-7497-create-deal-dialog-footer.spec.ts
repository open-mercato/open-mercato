import { expect, test, type Locator, type Page } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-7497: the Create deal modal footer forms an opaque boundary at the
 * dialog's bottom edge while the body scrolls (#7497).
 *
 * `DialogContent` is the scroll container (`p-6`, `overflow-y-auto`) and the
 * CrudForm footer is `position: sticky` inside it. Sticky offsets resolve
 * against the scroller's content box, so a `bottom-0` footer parked 24px above
 * the dialog edge and the scrolled association fields showed through that
 * padding strip. The footer now overlaps the padding and paints it, so at every
 * scroll position the band between the footer top and the dialog edge must
 * hit-test to the footer, the footer must end flush with the dialog, and the
 * last association field must still be reachable above it. A fitting (short)
 * dialog must not gain a blank band below the buttons.
 */
const STICKY_ANCESTOR = 'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sticky ")][1]';

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a bounding box`).not.toBeNull();
  return box!;
}

async function expectFooterSealsDialog(page: Page, dialog: Locator, footer: Locator, label: string) {
  const [dialogBox, footerBox] = await Promise.all([boxOf(dialog, 'dialog'), boxOf(footer, 'footer')]);
  const dialogBottom = dialogBox.y + dialogBox.height;
  const footerBottom = footerBox.y + footerBox.height;
  // Flush with the dialog edge (the dialog border is the only tolerance).
  expect(Math.abs(dialogBottom - footerBottom), `${label}: footer should end at the dialog edge`).toBeLessThanOrEqual(2);

  // Every point of the band between the footer top and the dialog edge belongs to the footer.
  const xs = [0.15, 0.5, 0.85].map((ratio) => dialogBox.x + dialogBox.width * ratio);
  const ys = [footerBox.y + 2, (footerBox.y + dialogBottom) / 2, dialogBottom - 3];
  const covered = await footer.evaluate(
    (footerNode, points: Array<[number, number]>) =>
      points.map(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && footerNode.contains(hit);
      }),
    xs.flatMap((x) => ys.map((y) => [x, y] as [number, number])),
  );
  expect(covered.every(Boolean), `${label}: nothing may show through the footer band`).toBe(true);
}

async function scrollDialogTo(dialog: Locator, position: 'top' | 'middle' | 'bottom') {
  await dialog.evaluate((node, where) => {
    const max = node.scrollHeight - node.clientHeight;
    node.scrollTop = where === 'top' ? 0 : where === 'middle' ? Math.round(max / 2) : max;
  }, position);
  await dialog.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openCreateDealDialog(page: Page, companyId: string, companyName: string) {
  await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  const dialog = page.getByRole('dialog', { name: 'Create deal' });
  // The page is reached at `commit`, so a click can land before it hydrates and do nothing.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('tab', { name: /^deals/i }).click({ timeout: 5_000 });
      await page.getByRole('button', { name: /^(Add deal|Create a deal)$/ }).first().click({ timeout: 5_000 });
    }
    await expect(dialog).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  const saveButton = dialog.getByRole('button', { name: /^Save deal/ });
  await expect(saveButton).toBeVisible();
  // DealForm resolves the linked company chip after opening, and the body keeps growing until then.
  await expect(dialog.getByRole('button', { name: companyName })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByPlaceholder(/search companies/i)).toBeVisible();
  return { dialog, footer: saveButton.locator(STICKY_ANCESTOR) };
}

test.describe('TC-CRM-7497: Create deal modal footer seals the scrolled body', () => {
  test('the pinned footer hides scrolled content down to the dialog edge and the last field stays reachable', async ({ page, request }) => {
    test.slow();

    const stamp = Date.now();
    let adminToken: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA Deal Footer ${stamp}`;

    try {
      adminToken = await getAuthToken(request, 'admin');
      companyId = await createCompanyFixture(request, adminToken, companyName);

      await login(page, 'admin');

      // Short viewport: the modal body must overflow so the footer actually sticks.
      await page.setViewportSize({ width: 1280, height: 620 });
      const { dialog, footer } = await openCreateDealDialog(page, companyId, companyName);
      await expect(footer).toBeVisible();
      await expect
        .poll(
          () => dialog.evaluate((node) => node.scrollHeight > node.clientHeight + 40),
          { message: 'the Create deal modal should overflow at a 620px viewport' },
        )
        .toBe(true);

      for (const position of ['top', 'middle', 'bottom'] as const) {
        await expect(async () => {
          await scrollDialogTo(dialog, position);
          await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
          await expect(dialog.getByRole('button', { name: /^Save deal/ })).toBeVisible();
          await expectFooterSealsDialog(page, dialog, footer, `scroll ${position}`);
        }).toPass({ timeout: 10_000 });
      }

      // Scrolled to the end, the last association field sits fully above the footer.
      // Late-loading fields can still grow the body, so scroll again on every attempt.
      const companiesSearch = dialog.getByPlaceholder(/search companies/i);
      await expect(async () => {
        await scrollDialogTo(dialog, 'bottom');
        const [searchBox, footerTop] = await Promise.all([boxOf(companiesSearch, 'companies search'), boxOf(footer, 'footer')]);
        expect(searchBox.y + searchBox.height, 'last association field should clear the footer').toBeLessThanOrEqual(footerTop.y + 1);
      }).toPass({ timeout: 10_000 });
      await companiesSearch.click();
      await expect(companiesSearch).toBeFocused();

      // No horizontal overflow and the footer stays inside the rounded dialog.
      const [dialogBox, footerBox] = await Promise.all([boxOf(dialog, 'dialog'), boxOf(footer, 'footer')]);
      expect(footerBox.x, 'footer should not leave the dialog on the left').toBeGreaterThanOrEqual(dialogBox.x - 1);
      expect(footerBox.x + footerBox.width, 'footer should not leave the dialog on the right').toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
      const scrollsHorizontally = await dialog.evaluate((node) => node.scrollWidth > node.clientWidth);
      expect(scrollsHorizontally, 'modal must not scroll horizontally').toBe(false);

      // Keyboard dismissal keeps working.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // Tall viewport: when the form fits, the footer still ends at the dialog edge
      // without a blank band below the buttons.
      await page.setViewportSize({ width: 1280, height: 2200 });
      const fitting = await openCreateDealDialog(page, companyId, companyName);
      await expect(async () => {
        const fits = await fitting.dialog.evaluate((node) => node.scrollHeight <= node.clientHeight + 1);
        expect(fits, 'the Create deal modal should fit a 2200px viewport').toBe(true);
        const [fitDialogBox, fitFooterBox] = await Promise.all([boxOf(fitting.dialog, 'dialog'), boxOf(fitting.footer, 'footer')]);
        expect(Math.abs(fitDialogBox.y + fitDialogBox.height - (fitFooterBox.y + fitFooterBox.height)), 'no blank band below the footer').toBeLessThanOrEqual(2);
      }).toPass({ timeout: 10_000 });
      await fitting.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(fitting.dialog).toBeHidden();
    } finally {
      await deleteEntityIfExists(request, adminToken, '/api/customers/companies', companyId);
    }
  });
});
