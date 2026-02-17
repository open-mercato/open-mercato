import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-ADMIN-003: View and Filter Audit Logs
 * Source: .ai/qa/scenarios/TC-ADMIN-003-audit-log-viewing.md
 *
 * Verifies that audit logs are accessible via the Security sidebar section,
 * display action and access log tabs, and show log entries with details.
 *
 * Navigation: Main sidebar → Security → Audit Logs
 */
test.describe('TC-ADMIN-003: View and Filter Audit Logs', () => {
  test('should display audit log tabs with action log entries', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/audit-logs');

    // Verify Action Log tab is selected by default
    const actionLogTab = page.getByRole('tab', { name: 'Action Log' });
    await expect(actionLogTab).toBeVisible();
    await expect(actionLogTab).toHaveAttribute('aria-selected', 'true');

    // Verify Access Log tab exists
    await expect(page.getByRole('tab', { name: 'Access Log' })).toBeVisible();

    // Verify Action Log heading
    await expect(page.getByRole('heading', { name: 'Action Log', level: 2 })).toBeVisible();

    // Verify the undoable only filter
    await expect(page.getByRole('checkbox', { name: 'Undoable only' })).toBeVisible();

    // Wait for table to load
    await page.getByText('Loading data...').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify table columns
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Resource' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'When' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();

    // Verify audit log entries exist (since we just logged in, there should be entries)
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible();

    // Switch to Access Log tab
    await page.getByRole('tab', { name: 'Access Log' }).click();
    await expect(page.getByRole('heading', { name: 'Access Log', level: 2 })).toBeVisible();
  });
});
