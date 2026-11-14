import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createClaimLine,
  listClaimLines,
  readClaim,
  readClaimLine,
  uniqueLabel,
  updateClaimLine,
  type ClaimLineItem,
} from './helpers'

/**
 * TC-WC-PRECISION-001: claim line credit amounts beyond 4 decimals; claim totals read back exactly.
 * Source: .ai/specs/2026-10-08-arbitrary-precision-money-and-fx.md
 */

const PRECISE_CREDIT = '1.123456789012345678'
const PRECISE_RESTOCKING_FEE = '0.000000000000000002'
const PRECISE_CORE_CREDIT = '0.000000000000000003'
const LARGE_CREDIT = '98765432109.876543210987654321'

test.describe('TC-WC-PRECISION-001: warranty claim amounts beyond float precision', () => {
  test('line amounts and header rollups keep every digit', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-precision')
    let currencyId: string | null = null
    let claimId: string | null = null

    try {
      const currency = await createRandomCurrencyFixture(request, token, {
        name: 'QA TC-WC-PRECISION-001',
        decimalPlaces: 18,
      })
      currencyId = currency.id

      const claim = await createClaimFixture(request, token, {
        claimType: 'return',
        customerName: `QA WC Precision ${stamp}`,
        reasonCode: 'damaged',
        currencyCode: currency.code,
        lines: [
          {
            lineNo: 1,
            sku: `WC-PREC-A-${stamp}`,
            productName: 'QA precise credit part',
            faultDescription: 'Credit beyond float precision',
            qtyClaimed: 1,
            creditAmount: PRECISE_CREDIT,
            restockingFee: PRECISE_RESTOCKING_FEE,
          },
        ],
      })
      claimId = claim.id
      expect(claim.currencyCode).toBe(currency.code)
      expect(claim.totalClaimedAmount, 'claimed total should equal the single line credit exactly').toBe(PRECISE_CREDIT)
      expect(claim.totalApprovedAmount, 'no line is approved yet').toBe('0')

      const [preciseLine] = await listClaimLines(request, token, claimId!)
      expect(preciseLine?.id, 'created claim should have a line').toBeTruthy()
      expect(preciseLine.creditAmount).toBe(PRECISE_CREDIT)
      expect(preciseLine.restockingFee).toBe(PRECISE_RESTOCKING_FEE)

      const appendResponse = await createClaimLine(
        request,
        token,
        {
          claimId,
          lineNo: 2,
          sku: `WC-PREC-B-${stamp}`,
          productName: 'QA large credit part',
          faultDescription: 'Large credit beyond float precision',
          qtyClaimed: 1,
          creditAmount: LARGE_CREDIT,
        },
        (await readClaim(request, token, claimId!)).updatedAt,
      )
      expect(appendResponse.status(), 'POST /api/warranty_claims/lines should return 201').toBe(201)

      const linesAfterAppend = await listClaimLines(request, token, claimId!)
      const largeLine = linesAfterAppend.find((line) => line.lineNo === 2) as ClaimLineItem
      expect(largeLine?.id, 'appended line should be readable').toBeTruthy()
      expect(largeLine.creditAmount).toBe(LARGE_CREDIT)

      const afterAppend = await readClaim(request, token, claimId!)
      expect(afterAppend.totalClaimedAmount, 'claimed total should sum both credits exactly').toBe(
        '98765432110.999999999999999999',
      )
      expect(afterAppend.totalApprovedAmount).toBe('0')

      const approvePrecise = await updateClaimLine(
        request,
        token,
        {
          id: preciseLine.id,
          claimId,
          qtyApproved: 1,
          lineStatus: 'approved',
          disposition: 'credit',
          coreCreditAmount: PRECISE_CORE_CREDIT,
        },
        preciseLine.updatedAt,
      )
      expect(approvePrecise.status(), 'approving the precise line should return 200').toBe(200)

      const approvedPreciseLine = await readClaimLine(request, token, claimId!, preciseLine.id!)
      expect(approvedPreciseLine.creditAmount).toBe(PRECISE_CREDIT)
      expect(approvedPreciseLine.restockingFee).toBe(PRECISE_RESTOCKING_FEE)
      expect(approvedPreciseLine.coreCreditAmount).toBe(PRECISE_CORE_CREDIT)

      const afterPreciseApproval = await readClaim(request, token, claimId!)
      expect(afterPreciseApproval.totalClaimedAmount).toBe('98765432110.999999999999999999')
      expect(
        afterPreciseApproval.totalApprovedAmount,
        'approved total should be credit minus restocking fee plus core credit, exactly',
      ).toBe('1.123456789012345679')

      const approveLarge = await updateClaimLine(
        request,
        token,
        {
          id: largeLine.id,
          claimId,
          qtyApproved: 1,
          lineStatus: 'approved',
          disposition: 'credit',
        },
        largeLine.updatedAt,
      )
      expect(approveLarge.status(), 'approving the large line should return 200').toBe(200)

      const fullyApproved = await readClaim(request, token, claimId!)
      expect(fullyApproved.totalClaimedAmount).toBe('98765432110.999999999999999999')
      expect(fullyApproved.totalApprovedAmount, 'approved total should carry into the integer part exactly').toBe(
        '98765432111',
      )
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })
})
