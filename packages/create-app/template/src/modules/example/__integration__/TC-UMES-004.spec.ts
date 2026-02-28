import { test, expect } from '@playwright/test'

test.describe('TC-UMES-004: transformFormData applyToForm opt-in', () => {
  test('TC-UMES-E20: default path — transformed payload does not update visible form fields', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('widget-transform-form-data')).toBeVisible()

    const titleInput = page.locator('[data-crud-field-id="title"] input').first()
    await titleInput.fill('  spaces around  ')
    await page.keyboard.press('Tab')

    await page.locator('form button[type="submit"]').first().click()

    // Payload should contain trimmed value
    await expect
      .poll(async () => page.getByTestId('phase-c-submit-result').textContent(), { timeout: 8_000 })
      .toContain('"title":"spaces around"')

    // Visible form field must NOT be updated — still shows the user-typed value
    await expect(titleInput).toHaveValue('  spaces around  ')
  })

  test('TC-UMES-E21: opt-in path — applyToForm: true reflects transformed values back into visible form fields', async ({
    page,
  }) => {
    const { login } = await import(
      '@open-mercato/core/modules/core/__integration__/helpers/auth'
    )
    await login(page, 'admin')
    await page.goto('/backend/umes-handlers')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('widget-transform-form-data')).toBeVisible()

    const noteInput = page.locator('[data-crud-field-id="note"] input').first()
    await noteInput.fill('transform: make me uppercase')
    await page.keyboard.press('Tab')

    await page.locator('form button[type="submit"]').first().click()

    // Payload should contain transformed value
    await expect
      .poll(async () => page.getByTestId('phase-c-submit-result').textContent(), { timeout: 8_000 })
      .toContain('"note":"MAKE ME UPPERCASE"')

    // Visible form field MUST be updated because applyToForm: true was returned
    await expect(noteInput).toHaveValue('MAKE ME UPPERCASE')
  })
})
