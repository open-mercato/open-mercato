import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  createShipmentFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  readClaim,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaimLine,
  type ClaimItem,
} from './helpers'

type SalesReturnResponse = {
  salesReturnId?: string
  skippedLineIds?: string[]
  error?: string
}

type SalesReturnClaimItem = ClaimItem & { salesReturnId?: string | null }

async function postSalesReturn(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  claimId: string,
  updatedAt?: string | null,
) {
  return apiRequest(request, 'POST', '/api/warranty_claims/sales-return', {
    token,
    data: { claimId, ...(updatedAt !== undefined ? { updatedAt } : {}) },
  })
}

async function approveClaimWithLine(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  orderId: string,
  orderLineId: string | null,
  stamp: string,
  qtyClaimed: number,
  qtyApproved: number,
): Promise<{ claim: SalesReturnClaimItem; lineId: string | null }> {
  let claim = await createClaimFixture(request, token, {
    claimType: 'return',
    channel: 'staff',
    orderId,
    currencyCode: 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-030-${stamp}`,
        productName: 'QA sales-return bridge product',
        qtyClaimed,
        ...(orderLineId ? { orderLineId } : {}),
      },
    ],
  })
  claim = await submitAndExpect(request, token, claim)
  claim = await transitionAndExpect(request, token, claim, 'in_review')
  const lines = await listClaimLines(request, token, claim.id!)
  const line = lines[0] ?? null
  if (line) {
    const approveResponse = await updateClaimLine(
      request,
      token,
      { id: line.id, claimId: claim.id, lineStatus: 'approved', qtyApproved },
      line.updatedAt,
    )
    expect(approveResponse.status(), 'line approval should return 200').toBe(200)
  }
  claim = await transitionAndExpect(request, token, claim, 'approved')
  return { claim: claim as SalesReturnClaimItem, lineId: line?.id ?? null }
}

test.describe('TC-WC-030: sales-return execution bridge', () => {
  test('rejects unauthenticated callers', async ({ request }) => {
    const response = await request.post('/api/warranty_claims/sales-return', {
      headers: { Cookie: '' },
      data: { claimId: '00000000-0000-4000-8000-000000000000' },
    })
    expect([401, 403]).toContain(response.status())
  })

  test('creates and links a sales return from approved lines, then blocks duplicates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-030')
    let orderId: string | null = null
    let claimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-030 bridged line ${stamp}`,
        quantity: 3,
      })
      await createShipmentFixture(request, token, orderId, [{ orderLineId, quantity: 3 }])

      const { claim } = await approveClaimWithLine(request, token, orderId, orderLineId, stamp, 2, 2)
      claimId = claim.id ?? null

      const wrongStatusProbe = await createClaimFixture(request, token, {
        claimType: 'return',
        channel: 'staff',
        orderId,
        currencyCode: 'USD',
        lines: [{ lineNo: 1, sku: `WC-030-DRAFT-${stamp}`, productName: 'QA draft probe', qtyClaimed: 1 }],
      })
      try {
        const draftResponse = await postSalesReturn(request, token, wrongStatusProbe.id!, wrongStatusProbe.updatedAt)
        const draftBody = await readJsonSafe<SalesReturnResponse>(draftResponse)
        expect(draftResponse.status(), `draft claim should be rejected: ${JSON.stringify(draftBody)}`).toBe(400)
        expect(draftBody?.error ?? '').toContain('salesReturnStatusNotEligible')
      } finally {
        await cancelThenDeleteClaimIfPossible(request, token, wrongStatusProbe.id ?? null)
      }

      const current = await readClaim(request, token, claim.id!)
      const createResponse = await postSalesReturn(request, token, claim.id!, current.updatedAt)
      const createBody = await readJsonSafe<SalesReturnResponse>(createResponse)
      expect(createResponse.status(), `sales-return create should return 200: ${JSON.stringify(createBody)}`).toBe(200)
      expect(createBody?.salesReturnId, 'response should include the created sales return id').toBeTruthy()
      expect(createBody?.skippedLineIds ?? []).toEqual([])

      const linked = await readClaim(request, token, claim.id!) as SalesReturnClaimItem
      expect(linked.salesReturnId, 'claim should be stamped with the sales return id').toBe(createBody?.salesReturnId)

      const duplicateResponse = await postSalesReturn(request, token, claim.id!, linked.updatedAt)
      const duplicateBody = await readJsonSafe<SalesReturnResponse>(duplicateResponse)
      expect(duplicateResponse.status(), 'second call should be rejected').toBe(400)
      expect(duplicateBody?.error ?? '').toContain('salesReturnAlreadyLinked')

      if (createBody?.salesReturnId) {
        await deleteSalesEntityIfExists(request, token, '/api/sales/returns', createBody.salesReturnId)
      }
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('translates the shipped-quantity cap and reports skipped lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-030b')
    let orderId: string | null = null
    let cappedClaimId: string | null = null
    let skippedClaimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-030b capped line ${stamp}`,
        quantity: 5,
      })
      await createShipmentFixture(request, token, orderId, [{ orderLineId, quantity: 1 }])

      const capped = await approveClaimWithLine(request, token, orderId, orderLineId, `${stamp}-cap`, 4, 4)
      cappedClaimId = capped.claim.id ?? null
      const cappedCurrent = await readClaim(request, token, capped.claim.id!)
      const cappedResponse = await postSalesReturn(request, token, capped.claim.id!, cappedCurrent.updatedAt)
      const cappedBody = await readJsonSafe<SalesReturnResponse>(cappedResponse)
      expect(cappedResponse.status(), `over-shipped quantity should be rejected: ${JSON.stringify(cappedBody)}`).toBe(400)
      expect(cappedBody?.error ?? '').toContain('salesReturnQuantityRejected')

      const skipped = await approveClaimWithLine(request, token, orderId, null, `${stamp}-skip`, 1, 1)
      skippedClaimId = skipped.claim.id ?? null
      const skippedCurrent = await readClaim(request, token, skipped.claim.id!)
      const skippedResponse = await postSalesReturn(request, token, skipped.claim.id!, skippedCurrent.updatedAt)
      const skippedBody = await readJsonSafe<SalesReturnResponse>(skippedResponse)
      expect(skippedResponse.status(), `claim without linkable lines should 400: ${JSON.stringify(skippedBody)}`).toBe(400)
      expect(skippedBody?.error ?? '').toContain('salesReturnNoEligibleLines')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, cappedClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, skippedClaimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
