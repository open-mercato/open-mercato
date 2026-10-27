import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { fixturePriority, uniqueStamp } from './helpers';

/**
 * TC-CGRP-018: membership assignment from the customer detail page
 * (`widgets/injection/person-groups-tab.tsx`, injected at
 * `detail:customers.person:tabs`).
 *
 * Source: .ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md
 * Step 1.14.
 *
 * The Groups tab is injected into `PersonDetailTabs` ("zone 2"), which is a
 * sibling of the collapsible CrudForm panel ("zone 1") on
 * `backend/customers/people-v2/[id]/page.tsx` — both `zone1Content` and
 * `zone2Content` are passed into `CollapsibleZoneLayout` and zone 2 renders
 * in every layout mode (collapsed rail, stacked-expanded, side-by-side; see
 * that component's `{zone2}` render in each branch). That differs from the
 * widgets injected directly into the CrudForm's own OWN field set
 * (`crud-form:customers.person:fields`, e.g. the customer_accounts "Account
 * status" card), which really do stay unmounted until "Expand form panel" is
 * clicked. Still, this test defensively expands the panel first if the
 * "Groups" tab is not immediately visible, so it stays correct even if that
 * assumption about zone-2 mounting changes later.
 */
async function openGroupsTab(page: Page): Promise<void> {
  const groupsTab = page.getByRole('tab', { name: 'Groups' });
  if (await groupsTab.isVisible().catch(() => false)) {
    await groupsTab.click();
    return;
  }
  const expandPanel = page.getByRole('button', { name: /expand form panel/i });
  if (await expandPanel.isVisible().catch(() => false)) {
    await expandPanel.click();
  }
  await expect(groupsTab).toBeVisible({ timeout: 15_000 });
  await groupsTab.click();
}

test.describe('TC-CGRP-018: membership assignment from the customer detail page', () => {
  test('assigning a person to a group via the dialog shows a "current" membership row', async ({ page, request }) => {
    test.setTimeout(90_000);
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    const groupName = `QA CGRP 018 Group ${stamp}`;
    const groupCode = `qa-cgrp-018-${stamp}`;

    let groupId: string | null = null;
    let personId: string | null = null;

    try {
      groupId = await createCustomerGroupFixture(request, token, {
        code: groupCode,
        name: groupName,
        priority: fixturePriority(stamp, 0),
      });
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `CGRP018 ${stamp}`,
        displayName: `QA CGRP018 ${stamp}`,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/people-v2/${personId}`, { waitUntil: 'domcontentloaded' });

      await openGroupsTab(page);

      const assignButton = page.getByRole('button', { name: 'Assign to group' }).first();
      await expect(assignButton).toBeVisible({ timeout: 15_000 });
      await assignButton.click();

      const dialog = page.getByRole('dialog', { name: 'Assign to group' });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const groupField = page.locator('[data-crud-field-id="groupId"]');
      const groupCombobox = groupField.getByRole('combobox');
      await groupCombobox.click();
      await groupCombobox.fill(groupName);
      await page.getByRole('option', { name: new RegExp(`^${groupName} \\(${groupCode}\\)$`) }).first().click();

      await dialog.getByRole('button', { name: 'Assign' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });

      const membershipList = page.getByRole('list', { name: 'Group memberships' });
      await expect(membershipList).toBeVisible({ timeout: 15_000 });
      const membershipRow = membershipList.getByRole('listitem').filter({ hasText: groupName });
      await expect(membershipRow).toBeVisible({ timeout: 10_000 });
      await expect(membershipRow.getByText('current', { exact: true })).toBeVisible();

      // The write reached the real API — confirm via a direct read.
      const membershipsResponse = await apiRequest(
        request,
        'GET',
        `/api/customer_groups/customer-groups/memberships?customerId=${encodeURIComponent(personId)}&pageSize=100`,
        { token },
      );
      expect(membershipsResponse.status()).toBe(200);
      const membershipsBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(membershipsResponse);
      const created = (membershipsBody?.items ?? []).find((item) => {
        const gid = (item.groupId ?? item.group_id) as string | undefined;
        return gid === groupId;
      });
      expect(created, 'the UI-assigned membership should be readable via the API').toBeTruthy();

      await deleteCustomerGroupMembershipIfExists(request, token, (created?.id as string | undefined) ?? null);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteCustomerGroupIfExists(request, token, groupId);
    }
  });
});
