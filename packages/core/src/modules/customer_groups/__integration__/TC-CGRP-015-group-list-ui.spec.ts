import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerGroupFixture,
  deleteCustomerGroupIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import { findDefaultGroupId, fixturePriority, restoreDefaultGroup, uniqueStamp } from './helpers';

/**
 * TC-CGRP-015: customer-groups admin list page (`/backend/customer-groups`)
 * renders real rows through the DataTable — code/name/kind/default/status
 * columns — and the "Create group" action navigates to the create page.
 *
 * Source: .ai/runs/2026-09-22-release-2-customer-groups-visibility/PLAN.md
 * Step 1.14 (Phase 1 UI paths, group list with drag-reorder — the list-render
 * + navigation half; drag-reorder itself is covered separately by
 * TC-CGRP-017).
 *
 * This is a UI-level test (drives the real admin page via `page`), distinct
 * from the API-level TC-CGRP-001..014 tenant-isolation/behavioral suite.
 * Creates two group fixtures via the API first so the list has deterministic
 * rows to assert on — a from-scratch run has no seeded customer groups, and
 * the shared dev/QA tenant may already have unrelated ones, so this locates
 * rows by their own unique fixture data rather than asserting on the whole
 * table.
 *
 * The `isDefault: true` fixture clears the tenant's existing default
 * (clear-and-set), so the pre-existing default is snapshotted up front and
 * restored in `finally`.
 */
test.describe('TC-CGRP-015: customer groups admin list page', () => {
  test('renders fixture rows with the expected columns and links to create', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();

    let defaultGroupId: string | null = null;
    let plainGroupId: string | null = null;
    let priorDefaultGroupId: string | null = null;

    try {
      priorDefaultGroupId = await findDefaultGroupId(request, token);
      defaultGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-015-def-${stamp}`,
        name: `QA CGRP 015 Default ${stamp}`,
        kind: 'b2b',
        priority: fixturePriority(stamp, 0),
        isDefault: true,
        isActive: true,
      });
      plainGroupId = await createCustomerGroupFixture(request, token, {
        code: `qa-cgrp-015-plain-${stamp}`,
        name: `QA CGRP 015 Plain ${stamp}`,
        kind: 'b2c',
        priority: fixturePriority(stamp, 1),
        isDefault: false,
        isActive: false,
      });

      await login(page, 'admin');
      await page.goto('/backend/customer-groups', { waitUntil: 'domcontentloaded' });

      // Locate rows by fixture code without touching the search box — the
      // unfiltered view is also what TC-CGRP-017 relies on for drag-reorder
      // wiring, so keep this test's locator strategy consistent with that one.
      const defaultRow = page.getByRole('row').filter({ hasText: `qa-cgrp-015-def-${stamp}` }).first();
      const plainRow = page.getByRole('row').filter({ hasText: `qa-cgrp-015-plain-${stamp}` }).first();
      await expect(defaultRow).toBeVisible({ timeout: 20_000 });
      await expect(plainRow).toBeVisible({ timeout: 20_000 });

      // Columns: code, name, kind, default, status all render per row.
      await expect(defaultRow.getByText(`QA CGRP 015 Default ${stamp}`, { exact: true })).toBeVisible();
      await expect(defaultRow.getByText('b2b', { exact: true })).toBeVisible();
      await expect(defaultRow.getByText('Default', { exact: true })).toBeVisible();
      await expect(defaultRow.getByText('Active', { exact: true })).toBeVisible();

      await expect(plainRow.getByText(`QA CGRP 015 Plain ${stamp}`, { exact: true })).toBeVisible();
      await expect(plainRow.getByText('b2c', { exact: true })).toBeVisible();
      await expect(plainRow.getByText('Inactive', { exact: true })).toBeVisible();
      // The non-default row must not carry the "Default" tag.
      await expect(plainRow.getByText('Default', { exact: true })).toHaveCount(0);

      await page.getByRole('link', { name: 'Create group' }).click();
      await page.waitForURL(/\/backend\/customer-groups\/create$/, { timeout: 15_000 });
    } finally {
      await deleteCustomerGroupIfExists(request, token, defaultGroupId);
      await deleteCustomerGroupIfExists(request, token, plainGroupId);
      await restoreDefaultGroup(request, token, priorDefaultGroupId);
    }
  });
});
