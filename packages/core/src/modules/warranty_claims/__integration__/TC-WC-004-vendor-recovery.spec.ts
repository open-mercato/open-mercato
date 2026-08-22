import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createVendorRecovery,
  listClaimLines,
  readClaim,
  resolveLineThroughLifecycle,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
} from './helpers'

test.describe('TC-WC-004: warranty claim vendor recovery', () => {
  test('creates linked vendor recovery claims only from unresolved-unlinked resolved lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-004')

    let sourceClaimId: string | null = null
    let recoveryClaimId: string | null = null
    let nonResolvedClaimId: string | null = null

    try {
      let source = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Vendor Source ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-004-A-${stamp}`,
            productName: 'QA vendor recovery part A',
            serialNumber: `SER-VR-A-${stamp}`,
            faultDescription: 'Recoverable vendor defect A',
            qtyClaimed: 1,
            creditAmount: 60,
          },
          {
            lineNo: 2,
            sku: `WC-004-B-${stamp}`,
            productName: 'QA vendor recovery part B',
            serialNumber: `SER-VR-B-${stamp}`,
            faultDescription: 'Recoverable vendor defect B',
            qtyClaimed: 2,
            creditAmount: 80,
          },
        ],
      })
      sourceClaimId = source.id
      const sourceLines = await listClaimLines(request, token, sourceClaimId!)
      expect(sourceLines).toHaveLength(2)

      source = await submitAndExpect(request, token, source)
      source = await transitionAndExpect(request, token, source, 'in_review')
      source = await transitionAndExpect(request, token, source, 'approved')
      for (const line of sourceLines) {
        await resolveLineThroughLifecycle(request, token, sourceClaimId!, line.id!, {
          qtyApproved: Number(line.qtyClaimed ?? 1),
          qtyReceived: Number(line.qtyClaimed ?? 1),
          creditAmount: Number(line.creditAmount ?? 10),
        })
      }
      source = await readClaim(request, token, sourceClaimId!)
      source = await transitionAndExpect(request, token, source, 'resolved', {
        resolutionSummary: `Source resolved ${stamp}`,
      })

      const lineIds = sourceLines.map((line) => line.id!).sort()
      const recoveryResponse = await createVendorRecovery(
        request,
        token,
        {
          claimId: sourceClaimId!,
          lineIds,
          vendorName: `QA Vendor ${stamp}`,
          vendorRef: `VR-${stamp}`,
        },
        source.updatedAt,
      )
      expect(recoveryResponse.status(), 'vendor recovery create should return 200').toBe(200)
      const recoveryBody = await readJsonSafe<{ claimId?: string }>(recoveryResponse)
      recoveryClaimId = recoveryBody?.claimId ?? null
      expect(recoveryClaimId, 'vendor recovery response should include claimId').toBeTruthy()

      const recovery = await readClaim(request, token, recoveryClaimId!)
      expect(recovery.claimType).toBe('vendor_recovery')
      expect(recovery.claimNumber).toMatch(/^VRC-/)
      expect(recovery.sourceClaimId).toBe(sourceClaimId)

      const recoveryLines = await listClaimLines(request, token, recoveryClaimId!)
      expect(recoveryLines).toHaveLength(2)

      const linkedSourceLines = await listClaimLines(request, token, sourceClaimId!)
      for (const sourceLine of linkedSourceLines) {
        expect(sourceLine.vendorClaimLineId, 'source line should be linked to copied recovery line').toBeTruthy()
      }

      const duplicateRecovery = await createVendorRecovery(request, token, {
        claimId: sourceClaimId!,
        lineIds,
        vendorName: `QA Vendor Duplicate ${stamp}`,
      })
      expect(duplicateRecovery.status(), 'same source lines cannot be vendor-recovered twice').toBe(400)

      const nonResolved = await createClaimFixture(request, token, {
        claimType: 'warranty',
        customerName: `QA WC Vendor Non Resolved ${stamp}`,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-004-NR-${stamp}`,
            productName: 'QA non-resolved vendor part',
            serialNumber: `SER-NR-${stamp}`,
            faultDescription: 'Not resolved yet',
            qtyClaimed: 1,
            creditAmount: 10,
          },
        ],
      })
      nonResolvedClaimId = nonResolved.id
      const [nonResolvedLine] = await listClaimLines(request, token, nonResolvedClaimId!)
      const nonResolvedRecovery = await createVendorRecovery(request, token, {
        claimId: nonResolvedClaimId!,
        lineIds: [nonResolvedLine.id!],
        vendorName: `QA Vendor Non Resolved ${stamp}`,
      })
      expect(nonResolvedRecovery.status(), 'non-resolved lines cannot be vendor-recovered').toBe(400)
    } finally {
      await cleanupDraftClaimWithLines(request, token, nonResolvedClaimId)
      await cleanupDraftClaimWithLines(request, token, recoveryClaimId)
      await cleanupDraftClaimWithLines(request, token, sourceClaimId)
    }
  })
})
