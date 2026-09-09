import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * TC-AUTH-SIDEBAR-LAYOUT-5314: the backend sidebar fits its panel and carries no phantom gaps.
 * Source: PR #5314 ("prevent horizontal sidebar scrolling and fix sidebar spacing") and the UI QA
 * run on it, which found the headline fix real but caught a new empty injection-spot wrapper that
 * still cost a `gap-3` on every backend page.
 *
 * Why this cannot be a jsdom test: horizontal overflow and the cost of an empty flex child are
 * computed-layout properties, and jsdom does no layout. The unit suite can only assert the class
 * contract (`empty:hidden` on the wrappers); this spec asserts the geometry that contract exists for.
 *
 * Why `scrollWidth <= clientWidth` alone is not the assertion: the scroll container carries
 * `overflow-x-hidden`, which makes that inequality true by construction and would keep passing if the
 * content stopped fitting. Every overflow check below therefore also measures each descendant's box
 * against the container's content box — a 0px overhang is what actually proves the content fits.
 *
 * Read-only: navigates and measures, creates no records, so there is nothing to tear down.
 */

const SIDEBAR_SCROLL = '[data-sidebar-scroll="true"]';
const CHROME_READY = '[data-testid="backend-chrome-ready"][data-ready="true"]';
const DRAWER_PANEL = '#mobile-drawer-tabpanel';

type OverflowReport = {
  scrollWidth: number;
  clientWidth: number;
  leftOverhang: number;
  rightOverhang: number;
};

async function login(page: Page): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
  ]);
  await page.goto('/login');
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
  await page.getByLabel('Email').fill('admin@acme.com');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('secret');
  await password.press('Enter');
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);
  await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });
}

async function measureOverflow(scroller: Locator): Promise<OverflowReport> {
  return scroller.evaluate((node) => {
    const style = window.getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const contentLeft = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const contentRight = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    let leftOverhang = 0;
    let rightOverhang = 0;
    for (const descendant of Array.from(node.querySelectorAll('*'))) {
      const descendantStyle = window.getComputedStyle(descendant);
      if (descendantStyle.position === 'fixed' || descendantStyle.display === 'none') continue;
      const rect = descendant.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      leftOverhang = Math.max(leftOverhang, contentLeft - rect.left);
      rightOverhang = Math.max(rightOverhang, rect.right - contentRight);
    }
    return {
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      leftOverhang: Math.round(leftOverhang),
      rightOverhang: Math.round(rightOverhang),
    };
  });
}

async function expectNoOverflow(page: Page, scroller: Locator, label: string): Promise<void> {
  const report = await measureOverflow(scroller);
  expect(report.scrollWidth, `${label}: scrollWidth vs clientWidth`).toBeLessThanOrEqual(report.clientWidth);
  expect(report.rightOverhang, `${label}: descendant overhang past the right content edge`).toBe(0);
  expect(report.leftOverhang, `${label}: descendant overhang past the left content edge`).toBe(0);

  const documentOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(documentOverflow.scrollWidth, `${label}: document scrollWidth`).toBeLessThanOrEqual(
    documentOverflow.clientWidth,
  );
}

test.describe('TC-AUTH-SIDEBAR-LAYOUT-5314: backend sidebar fits its panel with no phantom gaps', () => {
  test('sidebar content never overflows the panel at any tested width', async ({ page }) => {
    await login(page);

    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop expanded 1440px' },
      { width: 1024, height: 768, label: 'desktop 1024px' },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/backend');
      await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });
      const scroller = page.locator(SIDEBAR_SCROLL).first();
      await expect(scroller).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page, scroller, viewport.label);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/backend');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });
    await page.getByRole('button', { name: /toggle sidebar/i }).click();
    const collapsed = page.locator(SIDEBAR_SCROLL).first();
    await expect(collapsed).toBeVisible();
    await expectNoOverflow(page, collapsed, 'desktop collapsed rail');
  });

  test('no empty element survives as a flex child of the sidebar column', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/backend');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 30_000 });

    // The sidebar root is a `gap-3` flex column, so a rendered-but-empty child still costs a full
    // gap. This is the regression the PR's own UI QA caught: an InjectionSpot wrapper with no
    // registered widget must collapse rather than survive as a zero-height child.
    const emptyChildren = await page.locator(SIDEBAR_SCROLL).first().evaluate((scroller) => {
      const root = scroller.parentElement;
      if (!root) return [];
      return Array.from(root.children)
        .filter((child) => {
          const rect = child.getBoundingClientRect();
          const hasContent = (child.textContent ?? '').trim().length > 0 || child.children.length > 0;
          return !hasContent && rect.height === 0 && window.getComputedStyle(child).display !== 'none';
        })
        .map((child) => child.className);
    });
    expect(emptyChildren, 'empty flex children of the sidebar root').toEqual([]);
  });

  test('group separators and nav links share one inset', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/backend');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });

    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible({ timeout: 30_000 });

    const separatorEdges = await sidebar.evaluate((node) => {
      const groups = Array.from(node.querySelectorAll('[data-sidebar-group="true"]'));
      return groups
        .filter((group) => parseFloat(window.getComputedStyle(group).borderBottomWidth) > 0)
        .map((group) => {
          const rect = group.getBoundingClientRect();
          return { left: Math.round(rect.left), right: Math.round(rect.right) };
        });
    });
    expect(separatorEdges.length, 'groups carrying a separator border').toBeGreaterThan(0);
    expect(new Set(separatorEdges.map((edge) => edge.left)).size, 'distinct separator left edges').toBe(1);
    expect(new Set(separatorEdges.map((edge) => edge.right)).size, 'distinct separator right edges').toBe(1);

    const linkInsets = await sidebar.evaluate((node) => {
      const groups = Array.from(node.querySelectorAll('[data-sidebar-group="true"]'));
      const insets: number[] = [];
      for (const group of groups) {
        const groupRect = group.getBoundingClientRect();
        for (const link of Array.from(group.querySelectorAll('a'))) {
          const rect = link.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          insets.push(Math.round(rect.left - groupRect.left));
        }
      }
      return insets;
    });
    expect(linkInsets.length, 'measured nav links').toBeGreaterThan(0);
    expect(new Set(linkInsets).size, 'distinct nav link insets').toBe(1);
  });

  test('settings section view aligns the back link with its nav items', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/backend/settings');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });

    const sectionSidebar = page.getByTestId('appshell-section-sidebar');
    await expect(sectionSidebar).toBeVisible({ timeout: 30_000 });

    const backLink = page.getByTestId('appshell-section-back-to-main');
    await expect(backLink).toBeVisible();
    const backBox = await backLink.boundingBox();
    const firstItemBox = await sectionSidebar
      .locator(`${SIDEBAR_SCROLL} a`)
      .first()
      .boundingBox();
    expect(backBox).not.toBeNull();
    expect(firstItemBox).not.toBeNull();
    expect(Math.round(backBox!.x), 'back link left edge vs first section nav item').toBe(
      Math.round(firstItemBox!.x),
    );

    await expectNoOverflow(page, sectionSidebar.locator(SIDEBAR_SCROLL).first(), 'settings section sidebar');
  });

  test('mobile drawer clears its header and keeps padding', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/backend');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });

    await page.getByRole('button', { name: /open menu/i }).click();
    const panel = page.locator(DRAWER_PANEL);
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.locator(SIDEBAR_SCROLL).first()).toBeVisible({ timeout: 30_000 });

    // The sidebar root lays its children out with `gap`, which never applies above the first child,
    // so the drawer's own panel padding is what keeps the nav search off the drawer header.
    const clearance = await panel.evaluate((node) => {
      const input = node.querySelector('input');
      if (!input) return -1;
      return Math.round(input.getBoundingClientRect().top - node.getBoundingClientRect().top);
    });
    expect(clearance, 'nav search clearance below the drawer header').toBeGreaterThan(0);

    await expectNoOverflow(page, panel.locator(SIDEBAR_SCROLL).first(), 'mobile drawer');
  });

  test('mobile drawer keeps both settings tabs padded and free of overflow', async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/backend/settings');
    await page.waitForSelector(CHROME_READY, { state: 'attached', timeout: 30_000 });

    await page.getByRole('button', { name: /open menu/i }).click();
    const panel = page.locator(DRAWER_PANEL);
    await expect(panel).toBeVisible({ timeout: 30_000 });

    const tabs = page.getByRole('tab');
    const tabCount = await tabs.count();
    expect(tabCount, 'drawer tabs in section view').toBeGreaterThan(0);

    for (let index = 0; index < tabCount; index += 1) {
      await tabs.nth(index).click();
      const scroller = panel.locator(SIDEBAR_SCROLL).first();
      await expect(scroller).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page, scroller, `mobile drawer tab ${index}`);

      const insets = await scroller.evaluate((node) => {
        const containerLeft = node.getBoundingClientRect().left;
        return Array.from(node.querySelectorAll('a'))
          .filter((link) => {
            const rect = link.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((link) => Math.round(link.getBoundingClientRect().left - containerLeft));
      });
      expect(insets.length, `nav links on drawer tab ${index}`).toBeGreaterThan(0);
      expect(Math.min(...insets), `nav link inset on drawer tab ${index}`).toBeGreaterThan(0);
    }
  });
});
