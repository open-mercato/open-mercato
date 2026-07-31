import { expect, test, type Page } from '@playwright/test';

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

/** Hrefs of every link currently rendered in the backend sidebar. */
async function sidebarHrefs(page: Page): Promise<string[]> {
  const links = page.getByRole('navigation').getByRole('link');
  await expect(links.first()).toBeVisible({ timeout: 30_000 });
  return (await links.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href') ?? ''),
  )).filter(Boolean);
}

/**
 * The sidebar hydrates from the backend-chrome payload after first paint, so a single read can catch it
 * part-built. Polls until two consecutive reads agree before returning.
 */
async function settledSidebarHrefs(page: Page): Promise<string[]> {
  let previous: string[] = [];
  await expect
    .poll(
      async () => {
        const current = await sidebarHrefs(page);
        const settled = current.length > 1 && current.length === previous.length;
        previous = current;
        return settled;
      },
      { message: 'the sidebar nav should finish hydrating before it is measured', timeout: 30_000 },
    )
    .toBe(true);
  return previous;
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

    // Measure the main sidebar on /backend. Settings pages such as the customization page render a
    // different, larger nav, so every measurement below returns to /backend to stay comparable.
    await page.goto(BACKEND_PATH);
    const hrefsBefore = await settledSidebarHrefs(page);
    expect(hrefsBefore.length, 'the sidebar should render some entries to begin with').toBeGreaterThan(1);

    await page.goto(CUSTOMIZATION_PATH);

    const groupSwitch = page.getByRole('switch', { name: GROUP_SWITCH_NAME }).first();
    await expect(groupSwitch, 'the page should expose a group-level visibility switch').toBeVisible({
      timeout: 30_000,
    });

    const accessibleName = (await groupSwitch.getAttribute('aria-label')) ?? '';
    const groupName = accessibleName.replace(/^Show\s+/, '').trim();
    expect(groupName.length, 'the switch should name the group it controls').toBeGreaterThan(0);
    await expect(groupSwitch, 'the group should start visible').toHaveAttribute('aria-checked', 'true');

    const namedSwitch = () => page.getByRole('switch', { name: `Show ${groupName}` }).first();

    try {
      await groupSwitch.click();
      await expect(groupSwitch, 'one click should switch the whole group off').toHaveAttribute(
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

      // And the group's entries must really be gone from the main sidebar.
      await page.goto(BACKEND_PATH);
      const hrefsAfter = await settledSidebarHrefs(page);
      expect(
        hrefsAfter.length,
        `hiding "${groupName}" should remove its entries from the sidebar`,
      ).toBeLessThan(hrefsBefore.length);

      const removed = hrefsBefore.filter((href) => !hrefsAfter.includes(href));
      expect(removed.length, 'at least one nav entry should have been removed').toBeGreaterThan(0);
    } finally {
      // Restore, so the shared environment is left as found for other specs.
      await page.goto(CUSTOMIZATION_PATH).catch(() => undefined);
      await namedSwitch().click().catch(() => undefined);
      await saveAndSettle(page).catch(() => undefined);
    }

    await expect(namedSwitch(), 'toggling back on should restore the group').toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 30_000 },
    );
    await page.goto(BACKEND_PATH);
    const hrefsRestored = await settledSidebarHrefs(page);
    expect(hrefsRestored.length, 'restoring the group should bring its entries back').toBe(
      hrefsBefore.length,
    );
  });
});
