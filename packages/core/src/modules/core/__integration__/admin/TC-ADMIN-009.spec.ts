import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-ADMIN-009: View System Status Dashboard
 * Source: .ai/qa/scenarios/TC-ADMIN-009-system-status-view.md
 *
 * Verifies that the system status page displays environment variable
 * configuration sections for profiling, logging, security, caching,
 * query index, and entities.
 *
 * Navigation: Settings → System → System status
 */
test.describe('TC-ADMIN-009: View System Status Dashboard', () => {
  test('should display system status sections with environment variable details', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/config/system-status');

    // Wait for the page to load
    await expect(page.getByRole('heading', { name: 'System status', level: 2 })).toBeVisible();
    await expect(page.getByText('Review debugging, cache, and logging flags')).toBeVisible();

    // Wait for loading to finish
    await page.getByText('Loading status snapshot').waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // Verify runtime mode is shown
    await expect(page.getByText(/Runtime mode:/)).toBeVisible();

    // Verify key sections are present
    await expect(page.getByRole('heading', { name: 'Profiling', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Logging', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Security', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Caching', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Query index', level: 3 })).toBeVisible();

    // Verify at least one env var card shows Current value and Default
    await expect(page.getByText('Current value').first()).toBeVisible();
    await expect(page.getByText('Default').first()).toBeVisible();

    // Verify specific env var cards exist
    await expect(page.getByRole('heading', { name: 'Cache strategy', level: 4 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Database URL', level: 4 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Password min length', level: 4 })).toBeVisible();

    // Verify the page is accessible via Settings sidebar
    await expect(page.getByRole('link', { name: 'System status' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cache' })).toBeVisible();
  });
});
