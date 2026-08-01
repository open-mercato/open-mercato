import { expect, test, type Page } from '@playwright/test';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-SIDEBAR-GROUP-001: hiding a whole sidebar group from the customization page.
 * Source spec: .ai/specs/2026-04-27-ds-sidebar-customization-page.md ("Group-level visibility toggle").
 *
 * The unit coverage for this feature tests the pure reducer helpers, so it never exercises the real
 * `Switch`, the `onCheckedChange` inversion, persistence through a save, or whether the group's entries
 * actually leave the rendered sidebar. This drives the real page.
 *
 * Verified-against-source contract (`ui/backend/sidebar/SidebarCustomizationEditor.tsx`):
 * - a group switch's accessible name is `Show {group}`
 *   (`appShell.sidebarCustomizationShowGroup`), while per-item switches are the invariant `Show item` —
 *   which is how the two are distinguished here
 * - the save action is labelled `Create variant` while the caller has no stored preference yet
 *   (`isNewVariant`) and `Save` afterwards, so both names are accepted
 * - `AppShell` drops a group once every one of its items is hidden, so the group's nav entries must
 *   disappear from the sidebar
 *
 * The sidebar renders group *entries*, not group headings, so this asserts on the set of nav links
 * shrinking rather than on a group label being absent — the latter would pass vacuously.
 */

const BACKEND_PATH = '/backend';
const CUSTOMIZATION_PATH = '/backend/sidebar-customization';
const NAV_PATH = '/api/auth/admin/nav';
// Matches "Show Customers" but not the per-item "Show item".
const GROUP_SWITCH_NAME = /^Show (?!item$).+/;
// "Create variant" before a preference exists for this user, "Save" once one does.
const SAVE_ACTION_NAME = /^(Save|Create variant)$/;

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
}

async function sidebarHrefs(page: Page): Promise<string[]> {
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar).toBeVisible({ timeout: 30_000 });
  const links = sidebar.getByRole('link');
  return (await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href') ?? ''),
  )).filter(Boolean);
}

type NavPayload = {
  groups?: Array<{
    name?: string;
    defaultName?: string;
    items?: Array<{
      href?: string;
      hidden?: boolean;
      pageContext?: string;
    }>;
  }>;
};

async function visibleGroupHrefs(page: Page, groupName: string): Promise<string[]> {
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === NAV_PATH && response.ok(),
    { timeout: 30_000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('om:refresh-sidebar')));
  const response = await responsePromise;
  const payload = (await readJsonSafe<NavPayload>(response)) ?? {};
  const group = (payload.groups ?? []).find(
    (candidate) => candidate.name === groupName || candidate.defaultName === groupName,
  );
  return (group?.items ?? [])
    .filter((item) => item.hidden !== true && (!item.pageContext || item.pageContext === 'main'))
    .map((item) => item.href ?? '')
    .filter(Boolean);
}

async function expectGroupLinks(
  page: Page,
  groupHrefs: string[],
  visible: boolean,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const renderedHrefs = await sidebarHrefs(page);
        return groupHrefs.every((href) => renderedHrefs.includes(href) === visible);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function saveAndSettle(page: Page): Promise<void> {
  await page.getByRole('button', { name: SAVE_ACTION_NAME }).first().click();
  // The action relabels while in flight ("Saving…"/"Creating…"); wait for it to come back.
  await expect(page.getByRole('button', { name: SAVE_ACTION_NAME }).first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('sidebar group visibility toggle', () => {
  test('hides a whole group in one action, persists it, and drops its entries from the sidebar', async ({ page }) => {
    test.slow();
    await login(page);

    await page.goto(CUSTOMIZATION_PATH);

    const groupSwitch = page.getByRole('switch', { name: GROUP_SWITCH_NAME }).first();
    await expect(groupSwitch, 'the page should expose a group-level visibility switch').toBeVisible({
      timeout: 30_000,
    });

    const accessibleName = (await groupSwitch.getAttribute('aria-label')) ?? '';
    const groupName = accessibleName.replace(/^Show\s+/, '').trim();
    expect(groupName.length, 'the switch should name the group it controls').toBeGreaterThan(0);
    await expect(groupSwitch, 'the group should start visible').toHaveAttribute('aria-checked', 'true');
    const groupHrefs = await visibleGroupHrefs(page, groupName);
    expect(groupHrefs.length, `"${groupName}" should expose at least one main-nav entry`).toBeGreaterThan(0);

    const namedSwitch = () => page.getByRole('switch', { name: `Show ${groupName}` }).first();

    await page.goto(BACKEND_PATH);
    await expectGroupLinks(page, groupHrefs, true);
    await page.goto(CUSTOMIZATION_PATH);

    try {
      await namedSwitch().click();
      await expect(namedSwitch(), 'one click should switch the whole group off').toHaveAttribute(
        'aria-checked',
        'false',
      );

      await saveAndSettle(page);

      // Persistence: the state must survive a full reload, not merely live in the draft.
      await page.reload();
      await expect(namedSwitch(), 'the hidden state should survive a reload').toHaveAttribute(
        'aria-checked',
        'false',
        { timeout: 30_000 },
      );

      await expect
        .poll(() => visibleGroupHrefs(page, groupName), {
          message: `the nav payload should hide every entry in "${groupName}"`,
          timeout: 30_000,
        })
        .toEqual([]);

      await page.goto(BACKEND_PATH);
      await expectGroupLinks(page, groupHrefs, false);
    } finally {
      await page.goto(CUSTOMIZATION_PATH).catch(() => undefined);
      if ((await namedSwitch().getAttribute('aria-checked').catch(() => null)) === 'false') {
        await namedSwitch().click().catch(() => undefined);
        await saveAndSettle(page).catch(() => undefined);
      }
    }

    await expect(namedSwitch(), 'toggling back on should restore the group').toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 30_000 },
    );
    await expect
      .poll(() => visibleGroupHrefs(page, groupName), {
        message: `restoring "${groupName}" should restore every nav entry`,
        timeout: 30_000,
      })
      .toEqual(groupHrefs);
    await page.goto(BACKEND_PATH);
    await expectGroupLinks(page, groupHrefs, true);
  });
});
