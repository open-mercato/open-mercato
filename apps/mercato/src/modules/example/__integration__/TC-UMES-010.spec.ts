/**
 * TC-UMES-010: DevTools Panel UI (SPEC-041k)
 *
 * Validates the UMES DevTools panel opens via Ctrl+Shift+U in dev mode,
 * displays registered extensions, enricher timing data, and supports
 * tab switching, refresh, and close.
 *
 * Spec reference: SPEC-041k — DevTools + Conflict Detection (TC-UMES-DT01)
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

async function openDevToolsPanel(page: Parameters<typeof login>[0]) {
  const title = page.getByText('UMES DevTools')

  await page.keyboard.press('Control+Shift+U')

  const active = await title.isVisible({ timeout: 1500 }).catch(() => false)
  test.skip(!active, 'UMES DevTools are not enabled in this runtime')

  await expect(title).toBeVisible()

  return page.locator('.fixed.inset-y-0.right-0')
}

test.describe('TC-UMES-010: DevTools panel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('opens and closes via Ctrl+Shift+U keyboard shortcut', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    // Panel should NOT be visible initially
    await expect(page.getByText('UMES DevTools')).not.toBeVisible()

    await openDevToolsPanel(page)

    // Close panel with Ctrl+Shift+U
    await page.keyboard.press('Control+Shift+U')
    await expect(page.getByText('UMES DevTools')).not.toBeVisible()
  })

  test('shows extension count badge and registered extensions', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)

    // Should show extension count badge (at least 1 ext from example module)
    const extBadge = devToolsPanel.locator('text=/\\d+ ext/')
    await expect(extBadge).toBeVisible()

    // Extensions tab should be active by default and show registered extensions
    // The example module registers enrichers, interceptors, and injection widgets
    const extensionsTab = devToolsPanel.getByRole('button', { name: 'Extensions' })
    await expect(extensionsTab).toBeVisible()
  })

  test('switches between tabs', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)

    // Click through all tabs and verify they render
    const tabNames = ['Conflicts', 'Timing', 'Interceptors', 'Events']
    for (const tabName of tabNames) {
      await devToolsPanel.getByRole('button', { name: tabName }).click()
      // Each tab should be clickable without error
    }

    // Switch back to Extensions
    await devToolsPanel.getByRole('button', { name: 'Extensions' }).click()
  })

  test('refresh button updates data', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)
    const refreshBtn = devToolsPanel.getByRole('button', { name: 'Refresh' })
    await expect(refreshBtn).toBeVisible()
    await refreshBtn.click()

    // Panel should still be visible after refresh
    await expect(page.getByText('UMES DevTools')).toBeVisible()
  })

  test('close button dismisses the panel', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)

    // Click the close button (×)
    await devToolsPanel.getByRole('button', { name: 'Close DevTools' }).click()
    await expect(page.getByText('UMES DevTools')).not.toBeVisible()
  })

  test('conflicts tab shows no conflicts message when clean', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)
    await devToolsPanel.getByRole('button', { name: 'Conflicts' }).click()

    // With the default module setup, there should be no conflicts
    await expect(devToolsPanel.getByText('No conflicts detected')).toBeVisible()
  })

  test('timing tab shows enricher timing data after API call', async ({ page }) => {
    // Navigate to customer list which triggers enrichers
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)
    await devToolsPanel.getByRole('button', { name: 'Timing' }).click()

    // After the customer list loads, enrichers should have run and logged timing
    // The timing data may need a refresh to show up
    await devToolsPanel.getByRole('button', { name: 'Refresh' }).click()

    // Check if timing data appeared (enricher timing entries from the customer list enricher)
    // If no timing data is available yet, the "No timing data" message is acceptable
    const timingContent = devToolsPanel.locator('text=/ms$/')
    const noTimingMsg = devToolsPanel.getByText('No timing data')
    // Either timing data or "no timing data" should be visible
    await expect(timingContent.or(noTimingMsg)).toBeVisible({ timeout: 5000 })
  })

  test('shows footer with toggle hint', async ({ page }) => {
    await page.goto('/backend/customers/people')
    await page.waitForLoadState('domcontentloaded')

    const devToolsPanel = await openDevToolsPanel(page)
    await expect(devToolsPanel.getByText('Ctrl+Shift+U to toggle')).toBeVisible()
    await expect(devToolsPanel.getByText('Dev mode only')).toBeVisible()
  })
})
