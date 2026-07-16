import { expect, test, type Page } from '@playwright/test'

/**
 * TC-AGENT-UX-P0-005: Overview honesty labels.
 * Source: spec .ai/specs/enterprise/agent-orchestrator/2026-07-12-ux-p0-hotfixes.md
 * (§5 Overview honesty labels, Testing Strategy).
 *
 * The "Where humans stepped in" section renders illustrative figures until the
 * per-verb intervention taxonomy ships — it must carry the shared Sample chip,
 * and the hardcoded "Claims adjudication" domain chip must be gone from the
 * header for every tenant.
 */

const ADMIN_EMAIL = 'admin@acme.com'
const ADMIN_PASSWORD = 'secret'

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 })
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/backend/, { timeout: 10_000 })
}

test.describe('TC-AGENT-UX-P0-005: Overview sample labeling', () => {
  test('interventions section is Sample-labeled and the domain chip is gone', async ({ page }) => {
    test.slow()

    await loginAsAdmin(page)
    await page.goto('/backend/overview', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Claims adjudication')).toHaveCount(0)

    // The interventions section only renders once the tenant has agent
    // activity; on an active env it MUST carry the shared Sample chip.
    const sectionTitle = page.getByText('Where humans stepped in')
    if (await sectionTitle.isVisible().catch(() => false)) {
      const sectionHeader = page.locator('div', { has: sectionTitle }).first()
      await expect(sectionHeader.getByText('Sample', { exact: true })).toBeVisible()
    } else {
      await expect(page.getByText('No agent activity yet.')).toBeVisible()
    }
  })
})
