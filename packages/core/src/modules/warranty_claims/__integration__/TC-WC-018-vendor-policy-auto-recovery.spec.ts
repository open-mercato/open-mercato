import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  cancelThenDeleteClaimIfPossible,
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createVendorRecovery,
  createWarrantyVendorPolicyFixture,
  deleteWarrantyVendorPolicyIfExists,
  listClaimLines,
  listClaims,
  readClaim,
  readWarrantyVendorPolicy,
  resolveLineThroughLifecycle,
  submitAndExpect,
  transitionAndExpect,
  updateWarrantyVendorPolicy,
  uniqueLabel,
  type ClaimItem,
} from './helpers'

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.DATABASE_URL) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
}
process.env.QUEUE_BASE_DIR = process.env.QUEUE_BASE_DIR?.trim() || path.resolve(APP_ROOT, '.mercato/queue')

async function findVendorRecoveryForSource(
  token: string,
  request: Parameters<typeof listClaims>[0],
  sourceClaimId: string,
): Promise<ClaimItem | null> {
  const recoveries = await listClaims(request, token, 'claimType=vendor_recovery&pageSize=100&sortField=createdAt&sortDir=desc')
  return recoveries.find((claim) => claim.sourceClaimId === sourceClaimId) ?? null
}

async function waitForVendorRecovery(
  token: string,
  request: Parameters<typeof listClaims>[0],
  sourceClaimId: string,
): Promise<ClaimItem> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await drainIntegrationQueue('events', { appRoot: APP_ROOT })
    const recovery = await findVendorRecoveryForSource(token, request, sourceClaimId)
    if (recovery) return recovery
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  const recovery = await findVendorRecoveryForSource(token, request, sourceClaimId)
  expect(recovery, `vendor recovery should be generated for source claim ${sourceClaimId}`).toBeTruthy()
  return recovery as ClaimItem
}

test.describe('TC-WC-018: warranty vendor policy and automatic recovery', () => {
  test('auto-generates one VRC child for a resolved warranty claim matching an active policy', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-018')
    const vendorName = `QA Vendor ${stamp}`
    let policyId: string | null = null
    let sourceClaimId: string | null = null
    let recoveryClaimId: string | null = null

    try {
      const policy = await createWarrantyVendorPolicyFixture(request, adminToken, {
        vendorName,
        vendorRef: `VENDOR-REF-${stamp}`,
        coverageMonths: 18,
        claimableReasonCodes: ['defective'],
        recoveryRatePct: '75',
        contactEmail: `${stamp}@vendor.example.invalid`,
        autoGenerateRecovery: true,
        isActive: true,
      })
      policyId = policy.id
      expect(policy.vendorName).toBe(vendorName)
      expect(policy.autoGenerateRecovery).toBe(true)
      expect(policy.isActive).toBe(true)

      const policyUpdate = await updateWarrantyVendorPolicy(
        request,
        adminToken,
        { id: policy.id, vendorRef: `VENDOR-REF-UPDATED-${stamp}` },
        policy.updatedAt,
      )
      const policyUpdateBody = await readJsonSafe<{ ok?: boolean }>(policyUpdate)
      expect(policyUpdate.status(), `vendor policy update should return 200: ${JSON.stringify(policyUpdateBody)}`).toBe(200)
      const updatedPolicy = await readWarrantyVendorPolicy(request, adminToken, policy.id!)
      expect(updatedPolicy.vendorRef).toBe(`VENDOR-REF-UPDATED-${stamp}`)

      let sourceClaim = await createClaimFixture(request, adminToken, {
        claimType: 'warranty',
        customerName: `QA WC Auto Recovery ${stamp}`,
        vendorName,
        reasonCode: 'defective',
        currencyCode: 'USD',
        lines: [
          {
            lineNo: 1,
            sku: `WC-018-${stamp}`,
            productName: 'QA vendor policy product',
            serialNumber: `SER-018-${stamp}`,
            vendorName,
            faultCode: 'manufacturing-defect',
            faultDescription: 'Recoverable warranty defect',
            qtyClaimed: 1,
            creditAmount: 80,
          },
        ],
      })
      sourceClaimId = sourceClaim.id
      const [sourceLine] = await listClaimLines(request, adminToken, sourceClaim.id!)
      expect(sourceLine?.id, 'source claim should include a line').toBeTruthy()

      sourceClaim = await submitAndExpect(request, adminToken, sourceClaim)
      sourceClaim = await transitionAndExpect(request, adminToken, sourceClaim, 'in_review')
      sourceClaim = await transitionAndExpect(request, adminToken, sourceClaim, 'approved')
      await resolveLineThroughLifecycle(request, adminToken, sourceClaim.id!, sourceLine.id!, {
        qtyApproved: 1,
        qtyReceived: 1,
        creditAmount: 80,
      })
      sourceClaim = await transitionAndExpect(request, adminToken, sourceClaim, 'resolved', {
        resolutionSummary: `Resolved for automatic vendor recovery ${stamp}`,
      })

      const recovery = await waitForVendorRecovery(adminToken, request, sourceClaim.id!)
      recoveryClaimId = recovery.id
      expect(recovery.claimType).toBe('vendor_recovery')
      expect(recovery.claimNumber, 'auto-generated child should use the VRC- sequence').toContain('VRC-')
      expect(recovery.sourceClaimId).toBe(sourceClaim.id)
      expect(recovery.vendorName).toBe(vendorName)
      expect(recovery.vendorRef).toBe(`VENDOR-REF-UPDATED-${stamp}`)

      const refreshedSourceLines = await listClaimLines(request, adminToken, sourceClaim.id!)
      const refreshedSourceLine = refreshedSourceLines.find((line) => line.id === sourceLine.id)
      expect(refreshedSourceLine?.vendorClaimLineId, 'source line should link to generated vendor recovery line').toBeTruthy()

      const recoveryLines = await listClaimLines(request, adminToken, recovery.id!)
      expect(recoveryLines.length).toBe(1)
      expect(recoveryLines[0].vendorClaimLineId).toBe(sourceLine.id)
      expect(recoveryLines[0].creditAmount).toBeTruthy()

      const latestSourceClaim = await readClaim(request, adminToken, sourceClaim.id!)
      const duplicateResponse = await createVendorRecovery(
        request,
        adminToken,
        { claimId: sourceClaim.id!, lineIds: [sourceLine.id!], vendorName, vendorRef: updatedPolicy.vendorRef },
        latestSourceClaim.updatedAt,
      )
      expect(duplicateResponse.status(), 're-running vendor recovery for the same source line should be idempotent').toBe(400)
      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
      const recoveriesAfterRerun = await listClaims(request, adminToken, 'claimType=vendor_recovery&pageSize=100')
      expect(recoveriesAfterRerun.filter((claim) => claim.sourceClaimId === sourceClaim.id).length).toBe(1)
    } finally {
      await cleanupDraftClaimWithLines(request, adminToken, recoveryClaimId)
      await cancelThenDeleteClaimIfPossible(request, adminToken, sourceClaimId)
      await deleteWarrantyVendorPolicyIfExists(request, adminToken, policyId)
    }
  })
})
