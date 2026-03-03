/**
 * TC-UMES-004: Recursive Widget Extensibility (Phase J)
 *
 * Validates that widgets can declare their own injection spots and that
 * other widgets can inject into those nested spots — enabling layered
 * composition where modules extend other modules' widgets.
 *
 * Spec reference: SPEC-041j — Recursive Widget Extensibility
 */
import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-UMES-004: Recursive Widget Extensibility', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
  })

  test('TC-UMES-RW01: widget-level injection spot renders child widgets', async ({ page }) => {
    await page.goto('/backend/umes-next-phases')

    // The validation widget should be rendered (parent)
    const parentWidget = page.locator('.bg-blue-50').first()
    await expect(parentWidget).toBeVisible()

    // The addon widget should be rendered INSIDE the validation widget
    const addonWidget = page.getByTestId('recursive-widget-addon')
    await expect(addonWidget).toBeVisible()
    await expect(addonWidget).toContainText('Recursive addon')
    await expect(addonWidget).toContainText("injected into validation widget's nested spot")

    // Verify the addon is nested inside the parent widget's DOM
    const addonInsideParent = parentWidget.getByTestId('recursive-widget-addon')
    await expect(addonInsideParent).toBeVisible()
  })

  test('TC-UMES-RW02: nested widget onBeforeSave participates in save lifecycle', async ({ page }) => {
    await page.goto('/backend/umes-next-phases')

    // Collect console messages to verify the addon's onBeforeSave fires
    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        consoleMessages.push(msg.text())
      }
    })

    // Fill in the form
    const titleInput = page.getByLabel('Title')
    await titleInput.fill('recursive widget save test')

    // Submit the form
    await page.getByRole('button', { name: /save/i }).click()

    // Verify the submit result is recorded
    await expect(page.getByTestId('phase-j-submit-result')).toContainText('recursive widget save test')

    // Verify the addon's onBeforeSave handler was called
    await expect
      .poll(() => consoleMessages.some((msg) => msg.includes('[UMES] Nested addon widget onBeforeSave fired')), {
        timeout: 5_000,
      })
      .toBe(true)
  })

  test('TC-UMES-RW03: phase J readiness detects addon widget', async ({ page }) => {
    await page.goto('/backend/umes-next-phases')

    // Wait for the readiness check to detect the addon
    await expect(page.getByTestId('phase-status-j')).toHaveText('OK', { timeout: 10_000 })
  })

  test('TC-UMES-RW04: recursive addon also renders on todo create form', async ({ page }) => {
    await page.goto('/backend/todos/create')

    // The validation widget is injected into crud-form:example.todo
    // The addon should be recursively injected inside it
    const addonWidget = page.getByTestId('recursive-widget-addon')
    await expect(addonWidget).toBeVisible({ timeout: 10_000 })
    await expect(addonWidget).toContainText('Recursive addon')
  })
})
