import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'

test.describe('TC-UMES-009: Phase J recursive widget extensibility', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-extensions')
    await page.waitForLoadState('domcontentloaded')
  })

  test('TC-UMES-RW01: nested injection spot renders addon widget inside validation widget', async ({ page }) => {
    const validationWidget = page.locator('div.rounded.border', { hasText: 'Example Injection Widget' }).first()
    await expect(validationWidget).toBeVisible()

    const nestedHost = validationWidget.getByTestId('widget-recursive-addon-host')
    await expect(nestedHost).toBeVisible()
    await expect(nestedHost).toContainText("Addon injected into validation widget's nested spot")
  })

  test('TC-UMES-RW02: nested widget onBeforeSave participates in save lifecycle', async ({ page }) => {
    const consoleMessages: string[] = []
    page.on('console', (msg) => {
      consoleMessages.push(msg.text())
    })

    const titleInput = page.locator('[data-crud-field-id="title"] input').first()
    await expect(titleInput).toBeVisible()
    await titleInput.fill(`phase-j-${Date.now()}`)

    const noteInput = page.locator('[data-crud-field-id="note"] textarea').first()
    await noteInput.fill('nested-widget-lifecycle')

    const form = titleInput.locator('xpath=ancestor::form[1]')
    await form.locator('button[type="submit"]').first().click()

    await expect(page.getByTestId('phase-g-result')).toContainText('phase-j-', { timeout: 10_000 })
    await expect
      .poll(
        () => consoleMessages.some((entry) => entry.includes('[Example Widget] Before save validation:')),
        { timeout: 10_000 },
      )
      .toBe(true)
    await expect
      .poll(
        () => consoleMessages.some((entry) => entry.includes('[UMES] Nested addon widget onBeforeSave fired')),
        { timeout: 10_000 },
      )
      .toBe(true)
  })
})
