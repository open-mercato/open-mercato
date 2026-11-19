import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  readClaim,
  uniqueLabel,
} from './helpers'

/**
 * TC-WC-PRECISION-003: amounts typed into the claim line add/edit dialog keep every digit
 * in the stored line and the claim header rollup.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const CREATE_CREDIT = '1.123456789012345678'
const CREATE_RESTOCKING_FEE = '0.000000000000000002'
const EDIT_CREDIT = '2.000000000000000001'
const EDIT_CORE_CHARGE = '0.000000000000000004'
const LINES_API_PATH = '/api/warranty_claims/lines'

function moneyInput(dialog: Locator, fieldId: string) {
  return dialog.locator(`[data-crud-field-id="${fieldId}"] input`).first()
}

async function saveDialog(page: Page, dialog: Locator, method: 'POST' | 'PUT') {
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === LINES_API_PATH && response.request().method() === method,
  )
  await dialog.getByRole('button', { name: /^save/i }).first().click()
  const response = await saved
  expect(response.status(), `${method} ${LINES_API_PATH} should succeed`).toBeLessThan(400)
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test.describe('TC-WC-PRECISION-003: claim line dialog keeps exact amounts', () => {
  test('add and edit keep exact line amounts and the claimed total', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-precision-003')
    const productName = `QA dialog precise part ${stamp}`
    let currencyId: string | null = null
    let claimId: string | null = null

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-WC-PRECISION-003',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      const claim = await createClaimFixture(request, token, {
        claimType: 'return',
        customerName: `QA WC Precision 003 ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: currency.code,
        lines: [{ lineNo: 1, productName: `QA seed part ${stamp}`, qtyClaimed: 1, creditAmount: '1' }],
      })
      claimId = claim.id

      await login(page, 'admin')
      await page.goto(`/backend/warranty_claims/${claimId}`)

      await page.getByRole('button', { name: 'Add line', exact: true }).first().click()
      const createDialog = page.getByRole('dialog')
      await expect(createDialog).toBeVisible({ timeout: 10_000 })
      await fillControlledInput(createDialog.locator('[data-crud-field-id="productName"] input').first(), productName)
      await fillControlledInput(moneyInput(createDialog, 'creditAmount'), CREATE_CREDIT)
      await fillControlledInput(moneyInput(createDialog, 'restockingFee'), CREATE_RESTOCKING_FEE)
      await saveDialog(page, createDialog, 'POST')

      const created = (await listClaimLines(request, token, claimId!)).find((line) => line.productName === productName)
      expect(created?.creditAmount).toBe(CREATE_CREDIT)
      expect(created?.restockingFee).toBe(CREATE_RESTOCKING_FEE)
      expect((await readClaim(request, token, claimId!)).totalClaimedAmount).toBe('2.123456789012345678')

      const row = page.getByRole('row').filter({ hasText: productName })
      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Edit line', exact: true }).click()
      const editDialog = page.getByRole('dialog')
      await expect(moneyInput(editDialog, 'creditAmount')).toHaveValue(CREATE_CREDIT, { timeout: 10_000 })
      await fillControlledInput(moneyInput(editDialog, 'creditAmount'), EDIT_CREDIT)
      await fillControlledInput(moneyInput(editDialog, 'coreChargeAmount'), EDIT_CORE_CHARGE)
      await saveDialog(page, editDialog, 'PUT')

      const edited = (await listClaimLines(request, token, claimId!)).find((line) => line.productName === productName)
      expect(edited?.creditAmount).toBe(EDIT_CREDIT)
      expect(edited?.restockingFee).toBe(CREATE_RESTOCKING_FEE)
      expect(edited?.coreChargeAmount).toBe(EDIT_CORE_CHARGE)
      expect((await readClaim(request, token, claimId!)).totalClaimedAmount).toBe('3.000000000000000001')
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
