import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';

const OPEN_GROUPS_KEY = 'om:sidebarOpenGroups';
const COLLAPSED_KEY = 'om:sidebarCollapsed';

type SidebarGroupsPreference = {
  v: number;
  data: Record<string, boolean>;
};

test.afterEach(async ({ page }) => {
  if (page.isClosed()) return;
  await page.evaluate(({ openGroupsKey, collapsedKey }) => {
    localStorage.removeItem(openGroupsKey);
    localStorage.removeItem(collapsedKey);
    document.cookie = 'om_sidebar_collapsed=; path=/; max-age=0';
  }, { openGroupsKey: OPEN_GROUPS_KEY, collapsedKey: COLLAPSED_KEY });
});

test('TC-UI-001: sidebar storage preserves versioned groups, raw flags, and legacy preferences', async ({ page }) => {
  const readGroups = async (): Promise<SidebarGroupsPreference | null> => {
    const stored = await page.evaluate((key) => localStorage.getItem(key), OPEN_GROUPS_KEY);
    return stored === null ? null : JSON.parse(stored);
  };
  const sidebar = page.getByTestId('sidebar');
  const toggleSidebar = page.getByRole('button', { name: 'Toggle sidebar', exact: true });

  await login(page, 'admin');
  await page.goto('/backend');
  await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true');

  const firstGroup = sidebar.getByRole('button', { expanded: true }).first();
  await expect(firstGroup).toBeVisible();
  const groupName = (await firstGroup.textContent() ?? '').trim();
  const group = sidebar.getByRole('button', { name: groupName, exact: true });
  const groupKey = await test.step('Persist a collapsed group in a versioned envelope and restore it on reload', async () => {
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => Object.values((await readGroups())?.data ?? {})).toContain(false);

    const preference = await readGroups();
    expect(preference).toEqual({ v: 1, data: expect.any(Object) });
    const closedGroupKeys = Object.entries(preference?.data ?? {})
      .filter(([, isOpen]) => isOpen === false)
      .map(([key]) => key);
    expect(closedGroupKeys).toHaveLength(1);
    const [closedGroupKey] = closedGroupKeys;

    await page.reload();
    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true');
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(readGroups).toEqual({ v: 1, data: expect.objectContaining({ [closedGroupKey]: false }) });
    return closedGroupKey;
  });

  await test.step('Keep the sidebar collapse preference as a raw scalar', async () => {
    await toggleSidebar.click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), COLLAPSED_KEY)).toBe('1');
    await expect(group).toBeHidden();

    await toggleSidebar.click();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), COLLAPSED_KEY)).toBe('0');
    await expect(group).toBeVisible();
  });

  await test.step('Migrate a legacy bare group map without discarding its closed state', async () => {
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(readGroups).toEqual({ v: 1, data: expect.objectContaining({ [groupKey]: true }) });

    await page.evaluate(({ key, groupKey }) => {
      localStorage.setItem(key, JSON.stringify({ [groupKey]: false }));
    }, { key: OPEN_GROUPS_KEY, groupKey });
    await page.reload();

    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true');
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(readGroups).toEqual({ v: 1, data: expect.objectContaining({ [groupKey]: false }) });

    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(readGroups).toEqual({ v: 1, data: expect.objectContaining({ [groupKey]: true }) });
  });
});
