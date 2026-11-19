/**
 * TC-CRM-8540: a person's custom display name survives name edits until it is reset
 *
 * On `/backend/customers/people-v2/<id>`, the Personal data group edits the display name.
 * Verifies:
 * - changing the last name saves the new last name and keeps the custom display name
 * - Reset fills in first + last name, and saving stores that
 *
 * Fixture: one person created through the API and removed in `finally`.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }

const visibleInput = (page: Page, fieldId: string) =>
  page.locator(`[data-crud-field-id="${fieldId}"] input:visible`).first()

async function openPersonForm(page: Page, personId: string) {
  await page.goto(`/backend/customers/people-v2/${encodeURIComponent(personId)}`, { waitUntil: 'domcontentloaded' })
  const lastName = visibleInput(page, 'lastName')
  if (!(await lastName.isVisible().catch(() => false))) {
    const expandPanel = page.getByRole('button', { name: /expand form panel/i })
    await expect(expandPanel).toBeVisible({ timeout: 30_000 })
    await expandPanel.click()
  }
  await expect(lastName).toBeVisible({ timeout: 30_000 })
}

async function savePerson(page: Page) {
  const saveButton = page.getByRole('button', { name: /^save$/i }).first()
  await expect(saveButton).toBeEnabled({ timeout: 10_000 })
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/customers/people' && response.request().method() === 'PUT',
  )
  await saveButton.click()
  expect((await saved).status()).toBe(200)
  await expect(saveButton).toBeDisabled({ timeout: 15_000 })
}

async function storedDisplayName(request: APIRequestContext, token: string, personId: string) {
  const response = await apiRequest(request, 'GET', `/api/customers/people/${encodeURIComponent(personId)}`, { token })
  expect(response.status()).toBe(200)
  return (await readJsonSafe<{ person?: { displayName?: string } }>(response))?.person?.displayName
}

test.describe('TC-CRM-8540: person display name', () => {
  test('a custom name survives a last name edit and goes back to first + last on Reset', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const customName = `Dr. QA ${stamp}`
    const editedLastName = `Edited${stamp}`
    let personId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Name${stamp}`,
        displayName: customName,
      })

      await login(page, 'admin')
      await openPersonForm(page, personId)
      const lastName = visibleInput(page, 'lastName')
      await expect(visibleInput(page, 'displayName')).toHaveValue(customName)

      await lastName.fill(editedLastName)
      await expect(lastName).toHaveValue(editedLastName)
      await expect(visibleInput(page, 'displayName'), 'editing a name keeps the custom one').toHaveValue(customName)
      await savePerson(page)
      expect(await storedDisplayName(request, token, personId)).toBe(customName)

      // A fresh load, so the record lock's base version includes the save above.
      await openPersonForm(page, personId)
      await expect(visibleInput(page, 'displayName'), 'the saved custom name is still custom').toHaveValue(customName)
      await page.getByRole('button', { name: 'Reset to first & last name' }).first().click()
      await expect(visibleInput(page, 'displayName')).toHaveValue(`QA ${editedLastName}`)
      await savePerson(page)
      expect(await storedDisplayName(request, token, personId)).toBe(`QA ${editedLastName}`)
      await expect(page.getByRole('button', { name: 'Reset to first & last name' })).toHaveCount(0)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
