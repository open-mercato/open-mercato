import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'

async function openDevToolsPanel(page: Parameters<typeof login>[0]) {
  const title = page.getByText('UMES DevTools')

  await page.keyboard.press('Control+Shift+U')

  const active = await title.isVisible({ timeout: 1_500 }).catch(() => false)
  test.skip(!active, 'UMES DevTools are not enabled in this runtime')

  await expect(title).toBeVisible()

  return page.locator('.fixed.inset-y-0.right-0')
}

test.describe('TC-UMES-009: Phase J recursive widget extensibility', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
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
    await expect(page.getByTestId('widget-save-guard')).toBeVisible()
    await expect(page.getByTestId('widget-recursive-addon-host')).toContainText(
      "Addon injected into validation widget's nested spot",
    )

    await page.getByTestId('phase-c-load-transform-save-example').click()
    await expect(page.locator('[data-crud-field-id="title"] input').first()).toHaveValue('[confirm][transform] transform demo')

    page.once('dialog', (dialog) => {
      void dialog.accept()
    })

    const form = page.locator('form').first()
    await form.locator('button[type="submit"]').first().click()

    await expect(page.getByTestId('phase-c-submit-result')).toContainText('transform demo', { timeout: 10_000 })
    await expect(page.getByTestId('widget-save-guard')).toContainText('dialog:accepted', { timeout: 10_000 })
    await expect(page.getByTestId('widget-recursive-before-save')).toContainText('"fired":true', { timeout: 10_000 })
  })

  test('TC-UMES-RW03: generated injection registry exposes recursive widget spots in DevTools', async ({ page }) => {
    const validationWidget = page.locator('div.rounded.border', { hasText: 'Example Injection Widget' }).first()
    await expect(validationWidget).toBeVisible()
    await expect(validationWidget.getByTestId('widget-recursive-addon-host')).toContainText(
      "Addon injected into validation widget's nested spot",
    )

    const devToolsPanel = await openDevToolsPanel(page)
    await devToolsPanel.getByRole('button', { name: 'Refresh' }).click()

    await expect(devToolsPanel).toContainText('injection-widget')
    await expect(devToolsPanel).toContainText('example.injection.crud-validation')
    await expect(devToolsPanel).toContainText('crud-form:example.todo')
    await expect(devToolsPanel).toContainText('example:phase-c-handlers')
    await expect(devToolsPanel).toContainText('example.injection.crud-validation-addon')
    await expect(devToolsPanel).toContainText('widget:example.injection.crud-validation:addon')
  })
})
