import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { clickRowAction } from './helpers/marketing'

const RULES_PATH = '/api/marketing_automation/score-rules'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type Rule = { id: string; name: string; points: number; isEnabled: boolean; updatedAt: string }

async function findRule(request: APIRequestContext, token: string, name: string): Promise<Rule | null> {
  const response = await apiRequest(request, 'GET', `${RULES_PATH}?pageSize=100`, { token })
  const body = await readJsonSafe<{ items?: Rule[] }>(response)
  return (body?.items ?? []).find((rule) => rule.name === name) ?? null
}

async function removeRuleByName(request: APIRequestContext, token: string, name: string): Promise<void> {
  const rule = await findRule(request, token, name)
  if (!rule) return
  await apiRequest(request, 'DELETE', `${RULES_PATH}/${rule.id}`, { token, headers: { [LOCK_HEADER]: rule.updatedAt } })
}

async function confirmDialog(page: Page, button: 'Confirm' | 'Cancel'): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: button }).click()
  await expect(dialog).toBeHidden()
}

/**
 * TC-MA-040: the score rules screen and the profile's recalculate button.
 *
 * The rule made through the screen is switched OFF before it is saved, on purpose: it has no condition, and an
 * active rule with no condition awards points to every customer in the installation — which would break every
 * spec that asserts an untouched customer has none.
 */
test.describe('TC-MA-040 score rules screen', () => {
  // A login, a cold page and several saves: more than the default budget, and nothing here is slow by accident.
  test.describe.configure({ timeout: 90_000 })

  test('an operator creates, edits and removes a rule from the screen', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const name = `QA UI rule ${Date.now()}`
    try {
      await login(page, 'admin')
      /**
       * Waits for the list REQUEST, not for anything rendered.
       *
       * The table header is server-rendered, so seeing it says nothing about hydration — a name typed before it was
       * wiped by the hydration render. Only the hydrated client asks for the list, so its answer is the signal.
       */
      const listed = page.waitForResponse((response) =>
        response.url().includes('/api/marketing_automation/score-rules') && response.request().method() === 'GET')
      await page.goto('/backend/marketing/score-rules', { waitUntil: 'domcontentloaded' })
      await listed

      await fillControlledInput(page.locator('#score-rule-name'), name)
      await fillControlledInput(page.locator('#score-rule-points'), '0')
      await expect(page.getByText('A whole number other than zero. Negative numbers deduct.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

      await fillControlledInput(page.locator('#score-rule-points'), '7')
      await page.locator('#score-rule-enabled').click()
      await expect(page.locator('#score-rule-name')).toHaveValue(name)
      await expect(page.locator('#score-rule-enabled')).toHaveAttribute('aria-checked', 'false')
      await page.getByRole('button', { name: 'Save' }).click()

      const row = page.getByRole('row', { name: new RegExp(name) })
      await expect(row).toBeVisible({ timeout: 20_000 })
      await expect(row).toContainText('+7')
      await expect(row).toContainText('Off')
      const created = await findRule(request, token, name)
      expect(created).toMatchObject({ points: 7, isEnabled: false })

      await clickRowAction(page, row, 'Edit')
      await expect(page.locator('#score-rule-name')).toHaveValue(name)

      // Unsaved work is not thrown away without asking.
      await fillControlledInput(page.locator('#score-rule-points'), '-3')
      await page.getByRole('button', { name: 'New rule' }).click()
      await confirmDialog(page, 'Cancel')
      await expect(page.locator('#score-rule-points')).toHaveValue('-3')

      await page.getByRole('button', { name: 'Save' }).click()
      await expect(row).toContainText('-3', { timeout: 20_000 })
      expect((await findRule(request, token, name))?.points).toBe(-3)

      await clickRowAction(page, row, 'Remove')
      await confirmDialog(page, 'Confirm')
      await expect(row).toBeHidden({ timeout: 20_000 })
      expect(await findRule(request, token, name)).toBeNull()
    } finally {
      await removeRuleByName(request, token, name)
    }
  })

  test('the profile recalculates a customer and labels rule points as such', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const marker = `QA UI Rescore ${Date.now()}`
    const ruleName = `QA UI rescore rule ${marker}`
    let personId: string | null = null
    try {
      personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: 'Rescore', displayName: marker })
      const created = await apiRequest(request, 'POST', RULES_PATH, {
        token,
        data: {
          name: ruleName,
          points: 25,
          expression: { operator: 'AND', rules: [{ field: 'customer.displayName', operator: '=', value: marker }] },
        },
      })
      expect(created.status()).toBe(200)

      await login(page, 'admin')
      await page.goto(`/backend/marketing/customers/${personId}`, { waitUntil: 'domcontentloaded' })
      const button = page.getByRole('button', { name: 'Recalculate score' })
      await expect(button).toBeVisible({ timeout: 20_000 })
      await button.click()

      // Either this click wrote the entry or the queued pass got there first; both end in the same state.
      await expect(page.getByText(/Score rules applied: \+25 points\.|Score rules already up to date\./)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText(`Score rules · ${ruleName} +25`)).toBeVisible({ timeout: 20_000 })
    } finally {
      await removeRuleByName(request, token, ruleName)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
