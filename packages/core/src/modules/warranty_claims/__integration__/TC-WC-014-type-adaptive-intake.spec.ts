import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  listClaimLines,
  readClaimLine,
  updateClaimLine,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-014: warranty claim type-adaptive intake', () => {
  test('creates warranty and return claims, constrains line dispositions by type, and blocks generic vendor recovery create', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-014')
    const purchaseDate = new Date().toISOString()
    const createdClaimIds: string[] = []

    try {
      const warrantyClaim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Warranty ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-014-WTY-${stamp}`,
            productName: 'QA warranty intake product',
            serialNumber: `SER-014-WTY-${stamp}`,
            purchaseDate,
            faultDescription: 'Warranty intake line',
            qtyClaimed: 1,
            creditAmount: 20,
          },
        ],
      })
      createdClaimIds.push(warrantyClaim.id!)
      expect(warrantyClaim.claimType).toBe('warranty')
      expect(warrantyClaim.status).toBe('draft')
      expect(warrantyClaim.id, 'warranty claim should be created').toBeTruthy()

      const returnClaim = await createClaimFixture(request, adminToken, {
        claimType: 'return',
        customerName: `QA WC Return ${stamp}`,
        reasonCode: 'buyer-remorse',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-014-RET-${stamp}`,
            productName: 'QA return intake product',
            faultDescription: 'Return intake line',
            qtyClaimed: 1,
            creditAmount: 15,
          },
        ],
      })
      createdClaimIds.push(returnClaim.id!)
      expect(returnClaim.claimType).toBe('return')
      expect(returnClaim.status).toBe('draft')
      expect(returnClaim.id, 'return claim should be created').toBeTruthy()

      const returnLines = await listClaimLines(request, adminToken, returnClaim.id!)
      expect(returnLines.length, 'return claim should have one created line').toBe(1)
      const returnLineId = returnLines[0].id!
      const restockResponse = await updateClaimLine(
        request,
        adminToken,
        {
          id: returnLineId,
          claimId: returnClaim.id,
          disposition: 'restock',
        },
        returnLines[0].updatedAt,
      )
      expect(restockResponse.status(), 'restock should be allowed for return claims').toBe(200)
      const restockedLine = await readClaimLine(request, adminToken, returnClaim.id!, returnLineId)
      expect(restockedLine.disposition).toBe('restock')

      const disallowedResponse = await updateClaimLine(
        request,
        adminToken,
        {
          id: returnLineId,
          claimId: returnClaim.id,
          disposition: 'return_to_vendor',
        },
        restockedLine.updatedAt,
      )
      if (disallowedResponse.status() === 200) {
        const filteredLine = await readClaimLine(request, adminToken, returnClaim.id!, returnLineId)
        expect(
          filteredLine.disposition,
          'a return claim line must not persist a warranty/vendor-only disposition',
        ).not.toBe('return_to_vendor')
      } else {
        expect(disallowedResponse.status(), 'disallowed return disposition should be rejected').toBe(400)
      }

      const vendorRecoveryResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token: adminToken,
        data: {
          claimType: 'vendor_recovery',
          customerName: `QA WC Vendor Recovery ${stamp}`,
          vendorName: `QA Vendor ${stamp}`,
          reasonCode: 'defective',
          currencyCode: 'USD',
          lines: [
            {
              lineNo: 1,
              sku: `WC-014-VRC-${stamp}`,
              productName: 'QA vendor recovery generic create product',
              faultDescription: 'Generic vendor recovery create should be rejected',
              qtyClaimed: 1,
              creditAmount: 10,
            },
          ],
        },
      })
      const vendorRecoveryBody = await readJsonSafe<{ error?: string }>(vendorRecoveryResponse)
      expect(
        vendorRecoveryResponse.status(),
        `generic vendor recovery create should return 400: ${JSON.stringify(vendorRecoveryBody)}`,
      ).toBe(400)
      expect(vendorRecoveryBody?.error, 'generic vendor recovery rejection should include an error').toBeTruthy()
    } finally {
      for (const claimId of createdClaimIds.reverse()) {
        await cleanupDraftClaimWithLines(request, adminToken, claimId)
      }
    }
  })
})
