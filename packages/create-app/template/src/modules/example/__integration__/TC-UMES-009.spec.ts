import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

test.describe('TC-UMES-009: Phase J recursive widget extensibility', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('phase-c-submit-result')).toBeVisible()
  })

  test('TC-UMES-RW01: nested injection spot renders addon widget inside validation widget', async ({ page }) => {
    const nestedHost = page.getByTestId('widget-recursive-addon-host')
    await expect(nestedHost).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Example Injection Widget')).toBeVisible()
    await expect(nestedHost).toContainText("Addon injected into validation widget's nested spot")
  })

  test('TC-UMES-RW02: nested widget onBeforeSave participates in save lifecycle', async ({ page }) => {
    await expect(page.getByTestId('widget-save-guard')).toBeVisible()
    await expect(page.getByTestId('widget-recursive-addon-host')).toContainText(
      "Addon injected into validation widget's nested spot",
    )

    await page.getByTestId('phase-c-load-transform-save-example').click()
    await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue('[confirm][transform] transform demo')

    const form = page.locator('form').first()
    const dialogAccepted = page.waitForEvent('dialog').then(async (dialog) => {
      await dialog.accept()
    })
    await Promise.all([
      dialogAccepted,
      form.locator('button[type="submit"]').first().click(),
    ])

    await expect(page.getByTestId('phase-c-submit-result')).toContainText('transform demo', { timeout: 10_000 })
    await expect(page.getByTestId('widget-save-guard')).toContainText('dialog:accepted', { timeout: 10_000 })
    await expect(page.getByTestId('widget-recursive-before-save')).toContainText('"fired":true', { timeout: 10_000 })
  })
})
