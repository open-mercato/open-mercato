/**
 * TC-UMES-005: Phase L — Integration Extensions (Wizard, Badges, External IDs, Registry)
 *
 * Validates the UMES Phase L integration showcase page:
 *   L.1 Multi-step wizard widget (navigation, validation, completion)
 *   L.2 Status badge injection (rendering, cycling)
 *   L.3 External ID mapping display (Shopify/Stripe mock data)
 *   L.4 Integration registry (registerIntegration, title lookup, fallback)
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

const PAGE_URL = '/backend/umes-integrations'

test.describe('TC-UMES-005: Phase L — Integration Extensions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto(PAGE_URL)
    await page.waitForLoadState('domcontentloaded')
  })

  // --- L.1 Multi-Step Wizard Widget ---

  test('TC-UMES-L01: wizard renders with 3 steps and step indicator', async ({ page }) => {
    const wizardNav = page.locator('nav[aria-label="Steps"]')
    await expect(wizardNav).toBeVisible()

    const stepIndicators = wizardNav.locator('div.flex.items-center.justify-center.rounded-full')
    await expect(stepIndicators).toHaveCount(3)

    await expect(wizardNav).toContainText('Credentials')
    await expect(wizardNav).toContainText('Scope')
    await expect(wizardNav).toContainText('Schedule')
  })

  test('TC-UMES-L02: wizard step 1 validation rejects empty fields', async ({ page }) => {
    // Wait for wizard to be fully hydrated
    const wizardNav = page.locator('nav[aria-label="Steps"]')
    await expect(wizardNav).toBeVisible()
    const apiKeyInput = page.locator('[data-crud-field-id="apiKey"] input')
    await expect(apiKeyInput).toBeVisible()

    await page.getByRole('button', { name: 'Next', exact: true }).click()

    await expect(page.getByText('Both API key and API secret are required')).toBeVisible()
  })

  test('TC-UMES-L03: wizard completes all 3 steps and outputs result', async ({ page }) => {
    // Step 1 — fill credentials (Tab between fills to commit controlled input state)
    const apiKeyInput = page.locator('[data-crud-field-id="apiKey"] input')
    const apiSecretInput = page.locator('[data-crud-field-id="apiSecret"] input')
    await apiKeyInput.click()
    await apiKeyInput.fill('test-key-123')
    await page.keyboard.press('Tab')
    await apiSecretInput.fill('test-secret-456')
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // Step 2 — select sync direction
    const syncSelect = page.locator('[data-crud-field-id="syncDirection"] select')
    await expect(syncSelect).toBeVisible()
    await syncSelect.selectOption('bidirectional')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // Step 3 — select frequency and complete
    const freqSelect = page.locator('[data-crud-field-id="frequency"] select')
    await expect(freqSelect).toBeVisible()
    await freqSelect.selectOption('daily')
    await page.getByRole('button', { name: 'Complete', exact: true }).click()

    // Verify wizard result output
    const wizardResult = page.getByTestId('phase-l-wizard-result')
    await expect(wizardResult).toContainText('test-key-123')
    await expect(wizardResult).toContainText('test-secret-456')
    await expect(wizardResult).toContainText('bidirectional')
    await expect(wizardResult).toContainText('daily')

    // Status should be ok
    await expect(page.getByTestId('phase-l-status-wizard')).toContainText('phaseL_wizard=ok')
  })

  test('TC-UMES-L04: wizard back button navigates to previous step', async ({ page }) => {
    // Fill step 1 and go to step 2 (Tab between fills to commit controlled input state)
    const apiKeyInput = page.locator('[data-crud-field-id="apiKey"] input')
    const apiSecretInput = page.locator('[data-crud-field-id="apiSecret"] input')
    await apiKeyInput.click()
    await apiKeyInput.fill('key')
    await page.keyboard.press('Tab')
    await apiSecretInput.fill('secret')
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: 'Next', exact: true }).click()

    // Should be on step 2
    const syncSelect = page.locator('[data-crud-field-id="syncDirection"] select')
    await expect(syncSelect).toBeVisible()

    // Click back
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    // Should be back on step 1 with values preserved
    await expect(apiKeyInput).toBeVisible()
    await expect(apiKeyInput).toHaveValue('key')
    await expect(apiSecretInput).toHaveValue('secret')
  })

  // --- L.2 Status Badge Injection ---

  test('TC-UMES-L05: four status badges render with correct labels and initial colors', async ({ page }) => {
    const badgeContainer = page.getByTestId('phase-l-badges')
    await expect(badgeContainer).toBeVisible()

    await expect(badgeContainer).toContainText('Sync Engine')
    await expect(badgeContainer).toContainText('API Gateway')
    await expect(badgeContainer).toContainText('Queue Worker')
    await expect(badgeContainer).toContainText('Cache Layer')

    // Initial status dots: healthy(green), warning(yellow), error(red), unknown(gray)
    await expect(badgeContainer.locator('.bg-green-500').first()).toBeVisible()
    await expect(badgeContainer.locator('.bg-yellow-500').first()).toBeVisible()
    await expect(badgeContainer.locator('.bg-red-500').first()).toBeVisible()
    await expect(badgeContainer.locator('.bg-gray-400').first()).toBeVisible()
  })

  test('TC-UMES-L06: cycle button rotates all badge statuses', async ({ page }) => {
    const badgeContainer = page.getByTestId('phase-l-badges')
    await expect(badgeContainer).toBeVisible()

    // Before cycle: healthy(green), warning(yellow), error(red), unknown(gray)
    await expect(badgeContainer.locator('.bg-green-500')).toHaveCount(1)

    // Click cycle
    await page.getByTestId('phase-l-cycle-badges').click()

    // After one cycle: healthy→warning, warning→error, error→unknown, unknown→healthy
    // So now: warning(yellow), error(red), unknown(gray), healthy(green)
    // The green badge should still exist (moved from Sync Engine to Cache Layer)
    await expect(page.getByTestId('phase-l-badge-status')).toContainText('status=ok')

    // Click cycle again to verify continued rotation
    await page.getByTestId('phase-l-cycle-badges').click()
    await expect(page.getByTestId('phase-l-badge-status')).toContainText('status=ok')
  })

  // --- L.3 External ID Mapping Display ---

  test('TC-UMES-L07: external IDs widget renders Shopify and Stripe rows', async ({ page }) => {
    const externalIds = page.getByTestId('phase-l-external-ids')
    await expect(externalIds).toBeVisible()

    // Shopify row
    await expect(externalIds).toContainText('Shopify')
    await expect(externalIds.locator('code', { hasText: 'shp_prod_123' })).toBeVisible()

    // Stripe row
    await expect(externalIds).toContainText('Stripe')
    await expect(externalIds.locator('code', { hasText: 'cus_abc456' })).toBeVisible()
  })

  test('TC-UMES-L08: external IDs show correct sync status dots', async ({ page }) => {
    const externalIds = page.getByTestId('phase-l-external-ids')
    await expect(externalIds).toBeVisible()

    // Shopify is synced (green dot)
    await expect(externalIds.locator('.bg-green-500').first()).toBeVisible()

    // Stripe is pending (yellow dot)
    await expect(externalIds.locator('.bg-yellow-500').first()).toBeVisible()
  })

  test('TC-UMES-L09: Shopify row has external link', async ({ page }) => {
    const externalIds = page.getByTestId('phase-l-external-ids')
    await expect(externalIds).toBeVisible()

    const externalLink = externalIds.locator('a[target="_blank"][href*="shopify"]')
    await expect(externalLink).toBeVisible()
    await expect(externalLink).toHaveAttribute('href', /admin\.shopify\.com\/store\/demo\/products\/123/)
  })

  // --- L.4 Integration Registry ---

  test('TC-UMES-L10: integration registry shows registered integrations and title lookups', async ({ page }) => {
    const registry = page.getByTestId('phase-l-registry')
    await expect(registry).toBeVisible()

    // Two integrations registered
    await expect(registry).toContainText('sync_shopify')
    await expect(registry).toContainText('gateway_stripe')

    // Title lookup returns human-readable name
    await expect(registry).toContainText('"Shopify"')

    // Fallback for unknown ID returns the raw ID
    await expect(registry).toContainText('"unknown_id"')

    // Registry status should be ok
    await expect(page.getByTestId('phase-l-status-registry')).toContainText('phaseL_registry=ok')
  })

  // --- Page-level status ---

  test('TC-UMES-L11: page renders all four phase status indicators', async ({ page }) => {
    await expect(page.getByTestId('phase-l-status-wizard')).toBeVisible()
    await expect(page.getByTestId('phase-l-status-badges')).toBeVisible()
    await expect(page.getByTestId('phase-l-status-external-ids')).toContainText('phaseL_externalIds=ok')
    await expect(page.getByTestId('phase-l-status-registry')).toContainText('phaseL_registry=ok')
  })
})
