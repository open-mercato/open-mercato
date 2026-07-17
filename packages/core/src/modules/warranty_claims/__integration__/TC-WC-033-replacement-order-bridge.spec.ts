import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  canManageSalesOrders,
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/helpers/integration/salesFixtures'
import {
  cancelThenDeleteClaimIfPossible,
  createClaimFixture,
  listClaimLines,
  readClaim,
  readClaimEvents,
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaimLine,
  type ClaimItem,
} from './helpers'

type ReplacementOrderResponse = {
  replacementOrderId?: string
  skippedLineIds?: string[]
  error?: string
}

type ReplacementClaimItem = ClaimItem & {
  replacementOrderId?: string | null
  advanceReplacement?: boolean
  claimNumber?: string | null
}

async function postReplacementOrder(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  claimId: string,
  updatedAt?: string | null,
) {
  return apiRequest(request, 'POST', '/api/warranty_claims/replacement-order', {
    token,
    data: { claimId, ...(updatedAt !== undefined ? { updatedAt } : {}) },
  })
}

test.describe('TC-WC-033: replacement-order execution bridge', () => {
  test('rejects unauthenticated callers', async ({ request }) => {
    const response = await request.post('/api/warranty_claims/replacement-order', {
      headers: { Cookie: '' },
      data: { claimId: '00000000-0000-4000-8000-000000000000' },
    })
    expect([401, 403]).toContain(response.status())
  })

  test('creates a zero-priced replacement order from replace-disposition lines and blocks duplicates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-033')
    let orderId: string | null = null
    let claimId: string | null = null
    let replacementOrderId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const replaceLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-033 replace line ${stamp}`,
        quantity: 3,
      })
      const skippedLineOrderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-033 skipped line ${stamp}`,
        quantity: 1,
      })

      let claim = await createClaimFixture(request, token, {
        claimType: 'return',
        channel: 'staff',
        orderId,
        currencyCode: 'USD',
        lines: [
          { lineNo: 1, sku: `WC-033-A-${stamp}`, productName: 'QA replacement target', qtyClaimed: 2, orderLineId: replaceLineId },
          { lineNo: 2, sku: `WC-033-B-${stamp}`, productName: 'QA non-replace line', qtyClaimed: 1, orderLineId: skippedLineOrderLineId },
        ],
      }) as ReplacementClaimItem
      claimId = claim.id ?? null
      claim = await submitAndExpect(request, token, claim) as ReplacementClaimItem
      claim = await transitionAndExpect(request, token, claim, 'in_review') as ReplacementClaimItem
      const lines = await listClaimLines(request, token, claim.id!)
      const replaceLine = lines.find((line) => line.orderLineId === replaceLineId)
      const otherLine = lines.find((line) => line.orderLineId === skippedLineOrderLineId)
      expect(replaceLine, 'replace-disposition line should exist').toBeTruthy()
      expect(otherLine, 'non-replace line should exist').toBeTruthy()
      const approveReplace = await updateClaimLine(
        request,
        token,
        { id: replaceLine!.id, claimId: claim.id, lineStatus: 'approved', qtyApproved: 2, disposition: 'replace' },
        replaceLine!.updatedAt,
      )
      expect(approveReplace.status(), 'replace line approval should return 200').toBe(200)
      const approveOther = await updateClaimLine(
        request,
        token,
        { id: otherLine!.id, claimId: claim.id, lineStatus: 'approved', qtyApproved: 1 },
        otherLine!.updatedAt,
      )
      expect(approveOther.status(), 'non-replace line approval should return 200').toBe(200)
      claim = await transitionAndExpect(request, token, claim, 'approved') as ReplacementClaimItem

      const current = await readClaim(request, token, claim.id!) as ReplacementClaimItem
      const createResponse = await postReplacementOrder(request, token, claim.id!, current.updatedAt)
      const createBody = await readJsonSafe<ReplacementOrderResponse>(createResponse)
      expect(createResponse.status(), `replacement-order create should return 200: ${JSON.stringify(createBody)}`).toBe(200)
      expect(createBody?.replacementOrderId, 'response should include the created order id').toBeTruthy()
      replacementOrderId = createBody?.replacementOrderId ?? null
      expect(createBody?.skippedLineIds ?? [], 'the non-replace line should be reported as skipped').toEqual([otherLine!.id])

      const linked = await readClaim(request, token, claim.id!) as ReplacementClaimItem
      expect(linked.replacementOrderId, 'claim should be stamped with the replacement order id').toBe(replacementOrderId)
      expect(linked.advanceReplacement, 'pre-receipt creation should mark advance replacement').toBe(true)

      const events = await readClaimEvents(request, token, claim.id!)
      const creationEvent = events.find((event) => {
        const payload = (event.payload ?? null) as Record<string, unknown> | null
        return payload?.action === 'replacement_order_created'
      })
      expect(creationEvent, 'a replacement_order_created timeline event should be recorded').toBeTruthy()

      const orderRead = await apiRequest(request, 'GET', `/api/sales/orders?id=${replacementOrderId}`, { token })
      const orderBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(orderRead)
      const replacementOrder = orderBody?.items?.[0] ?? null
      expect(replacementOrder, 'replacement order should be readable via the sales API').toBeTruthy()
      const metadata = (replacementOrder?.metadata ?? null) as Record<string, unknown> | null
      expect(metadata?.warrantyClaimId, 'order metadata should carry the claim id').toBe(claim.id)
      expect(metadata?.warrantyClaimNumber, 'order metadata should carry the claim number').toBe(linked.claimNumber)

      const orderLinesRead = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${replacementOrderId}`, { token })
      const orderLinesBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(orderLinesRead)
      const replacementLines = orderLinesBody?.items ?? []
      expect(replacementLines.length, 'exactly the replace-disposition line should be replicated').toBe(1)
      const replicatedLine = replacementLines[0] ?? {}
      expect(Number(replicatedLine.quantity ?? -1), 'replacement quantity should equal the approved quantity').toBe(2)
      expect(
        Number(replicatedLine.unit_price_gross ?? replicatedLine.unitPriceGross ?? -1),
        'replacement lines should be zero-priced by default',
      ).toBe(0)
      expect(
        Number(replicatedLine.unit_price_net ?? replicatedLine.unitPriceNet ?? -1),
        'replacement lines should be zero-priced by default',
      ).toBe(0)

      const duplicateResponse = await postReplacementOrder(request, token, claim.id!, linked.updatedAt)
      const duplicateBody = await readJsonSafe<ReplacementOrderResponse>(duplicateResponse)
      expect(duplicateResponse.status(), 'second call should be rejected').toBe(400)
      expect(duplicateBody?.error ?? '').toContain('replacementAlreadyLinked')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (replacementOrderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', replacementOrderId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('rejects ineligible statuses and claims without replace-disposition lines', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-033b')
    let orderId: string | null = null
    let draftClaimId: string | null = null
    let noReplaceClaimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-033b line ${stamp}`,
        quantity: 2,
      })

      const draftClaim = await createClaimFixture(request, token, {
        claimType: 'return',
        channel: 'staff',
        orderId,
        currencyCode: 'USD',
        lines: [{ lineNo: 1, sku: `WC-033-DRAFT-${stamp}`, productName: 'QA draft probe', qtyClaimed: 1, orderLineId }],
      })
      draftClaimId = draftClaim.id ?? null
      const draftResponse = await postReplacementOrder(request, token, draftClaim.id!, draftClaim.updatedAt)
      const draftBody = await readJsonSafe<ReplacementOrderResponse>(draftResponse)
      expect(draftResponse.status(), `draft claim should be rejected: ${JSON.stringify(draftBody)}`).toBe(400)
      expect(draftBody?.error ?? '').toContain('replacementInvalidStatus')

      let noReplaceClaim = await createClaimFixture(request, token, {
        claimType: 'return',
        channel: 'staff',
        orderId,
        currencyCode: 'USD',
        lines: [{ lineNo: 1, sku: `WC-033-NR-${stamp}`, productName: 'QA credit-only line', qtyClaimed: 1, orderLineId }],
      })
      noReplaceClaimId = noReplaceClaim.id ?? null
      noReplaceClaim = await submitAndExpect(request, token, noReplaceClaim)
      noReplaceClaim = await transitionAndExpect(request, token, noReplaceClaim, 'in_review')
      const lines = await listClaimLines(request, token, noReplaceClaim.id!)
      const line = lines[0]
      expect(line, 'probe line should exist').toBeTruthy()
      const approve = await updateClaimLine(
        request,
        token,
        { id: line!.id, claimId: noReplaceClaim.id, lineStatus: 'approved', qtyApproved: 1, disposition: 'credit' },
        line!.updatedAt,
      )
      expect(approve.status(), 'line approval should return 200').toBe(200)
      noReplaceClaim = await transitionAndExpect(request, token, noReplaceClaim, 'approved')

      const current = await readClaim(request, token, noReplaceClaim.id!)
      const response = await postReplacementOrder(request, token, noReplaceClaim.id!, current.updatedAt)
      const body = await readJsonSafe<ReplacementOrderResponse>(response)
      expect(response.status(), `claim without replace-disposition lines should 400: ${JSON.stringify(body)}`).toBe(400)
      expect(body?.error ?? '').toContain('replacementNoEligibleLines')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, draftClaimId)
      await cancelThenDeleteClaimIfPossible(request, token, noReplaceClaimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
