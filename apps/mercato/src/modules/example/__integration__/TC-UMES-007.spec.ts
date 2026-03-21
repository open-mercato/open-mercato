/**
 * TC-UMES-007: Mutation Lifecycle — UI Showcase Page Tests (Phase M)
 *
 * Validates the Phase M showcase page at /backend/mutation-lifecycle.
 * Exercises the guard probe (m1) and sync subscriber probe (m2) through
 * the interactive UI, verifying status updates, probe results, and
 * error handling via data-testid attributes.
 *
 * Spec reference: SPEC-041m — Mutation Lifecycle Hooks
 * Source scenarios:
 *   - .ai/qa/scenarios/TC-UMES-ML05-showcase-page-guard-probe.md
 *   - .ai/qa/scenarios/TC-UMES-ML06-showcase-page-sync-probe.md
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-UMES-007: Mutation Lifecycle — Showcase Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/mutation-lifecycle')
    await page.waitForLoadState('domcontentloaded')
  })

  test('TC-UMES-ML05a: showcase page renders all four phase sections', async ({
    page,
  }) => {
    // Verify all 4 phase sections are visible
    await expect(page.getByText('Phase m1 — Mutation Guard Registry')).toBeVisible()
    await expect(page.getByText('Phase m2 — Sync Event Subscribers')).toBeVisible()
    await expect(page.getByText('Phase m3 — Client-Side Event Filtering')).toBeVisible()
    await expect(page.getByText('Phase m4 — Command Interceptors')).toBeVisible()

    // Verify initial status is idle for interactive probes
    await expect(page.getByTestId('phase-m-status-m1')).toContainText('phaseM1=idle')
    await expect(page.getByTestId('phase-m-status-m2')).toContainText('phaseM2=idle')

    // m3 and m4 are informational — show ok
    await expect(page.getByTestId('phase-m-status-m3')).toContainText('phaseM3=ok')
    await expect(page.getByTestId('phase-m-status-m4')).toContainText('phaseM4=ok')
  })

  test('TC-UMES-ML05b: guard probe creates and cleans up a todo successfully', async ({
    page,
  }) => {
    // Click the guard probe button
    await expect(page.getByTestId('phase-m1-run-probe')).toBeEnabled()
    await page.getByTestId('phase-m1-run-probe').click()

    // Wait for completion
    await expect(page.getByTestId('phase-m1-status')).toContainText('status=ok', {
      timeout: 20_000,
    })

    // Verify result contains an id (todo was created)
    const resultText = await page.getByTestId('phase-m1-result').textContent()
    expect(resultText).toContain('"id"')

    // Verify no error is displayed
    await expect(page.getByTestId('phase-m1-error')).not.toBeVisible()
  })

  test('TC-UMES-ML05c: guard probe is idempotent — runs twice with same result', async ({
    page,
  }) => {
    test.slow()

    // First run
    await expect(page.getByTestId('phase-m1-run-probe')).toBeEnabled()
    await page.getByTestId('phase-m1-run-probe').click()
    await expect(page.getByTestId('phase-m1-status')).toContainText('status=ok', {
      timeout: 20_000,
    })

    // Second run
    await expect(page.getByTestId('phase-m1-run-probe')).toBeEnabled()
    await page.getByTestId('phase-m1-run-probe').click()
    await expect(page.getByTestId('phase-m1-status')).toContainText('status=ok', {
      timeout: 20_000,
    })

    await expect(page.getByTestId('phase-m1-error')).not.toBeVisible()
  })

  test('TC-UMES-ML06a: sync subscriber probe — all three probes pass', async ({
    page,
  }) => {
    // Click the sync probe button
    await page.getByTestId('phase-m2-run-probe').click()

    // Wait for overall status to resolve
    await expect(page.getByTestId('phase-m2-status')).toContainText('status=ok', {
      timeout: 20_000,
    })

    // Verify no error displayed
    await expect(page.getByTestId('phase-m2-error')).not.toBeVisible()
  })

  test('TC-UMES-ML06b: sync probe — defaultPriority reports ok with 201', async ({
    page,
  }) => {
    await page.getByTestId('phase-m2-run-probe').click()

    // Wait for completion
    await expect(page.getByTestId('phase-m2-status')).not.toContainText('status=pending', {
      timeout: 20_000,
    })

    // Check individual probe result
    const defaultPriority = page.getByTestId('phase-m2-probe-defaultPriority')
    await expect(defaultPriority).toContainText('status=ok')
    await expect(defaultPriority).toContainText('httpStatus=201')
    await expect(defaultPriority).toContainText('auto-default-priority')
  })

  test('TC-UMES-ML06c: sync probe — preventUncomplete reports ok with 422', async ({
    page,
  }) => {
    await page.getByTestId('phase-m2-run-probe').click()

    await expect(page.getByTestId('phase-m2-status')).not.toContainText('status=pending', {
      timeout: 20_000,
    })

    const preventUncomplete = page.getByTestId('phase-m2-probe-preventUncomplete')
    await expect(preventUncomplete).toContainText('status=ok')
    await expect(preventUncomplete).toContainText('httpStatus=422')
    await expect(preventUncomplete).toContainText('prevent-uncomplete')
  })

  test('TC-UMES-ML06d: sync probe — auditDelete reports ok with 200', async ({
    page,
  }) => {
    await page.getByTestId('phase-m2-run-probe').click()

    await expect(page.getByTestId('phase-m2-status')).not.toContainText('status=pending', {
      timeout: 20_000,
    })

    const auditDelete = page.getByTestId('phase-m2-probe-auditDelete')
    await expect(auditDelete).toContainText('status=ok')
    await expect(auditDelete).toContainText('httpStatus=200')
    await expect(auditDelete).toContainText('audit-delete')
  })

  test('TC-UMES-ML06e: sync probe — payloads section shows all step data', async ({
    page,
  }) => {
    await page.getByTestId('phase-m2-run-probe').click()

    await expect(page.getByTestId('phase-m2-status')).toContainText('status=ok', {
      timeout: 20_000,
    })

    // The result section should contain payloads from all steps
    const resultText = await page.getByTestId('phase-m2-result').textContent()
    expect(resultText).toContain('"create"')
    expect(resultText).toContain('"markDone"')
    expect(resultText).toContain('"revert"')
    expect(resultText).toContain('"delete"')
  })

  // ── Navigation links ───────────────────────────────────────────────

  test('TC-UMES-ML-nav: phase m3 link navigates to CrudForm injection page', async ({
    page,
  }) => {
    const phaseGLink = page.getByRole('link', { name: /Open Phase G/i })
    await expect(phaseGLink).toBeVisible()
    await expect(phaseGLink).toHaveAttribute('href', '/backend/umes-extensions')
  })

  test('TC-UMES-ML-nav2: phase m4 link navigates to customers page', async ({
    page,
  }) => {
    const customersLink = page.getByRole('link', { name: /Open customers/i })
    await expect(customersLink).toBeVisible()
    await expect(customersLink).toHaveAttribute('href', '/backend/customers/people')
  })
})
