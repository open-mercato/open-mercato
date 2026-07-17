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
  submitAndExpect,
  transitionAndExpect,
  uniqueLabel,
  updateClaim,
  updateClaimLine,
  type ClaimItem,
} from './helpers'

type CreditMemoResponse = {
  creditMemoId?: string
  skippedLineIds?: string[]
  grandTotalGrossAmount?: string
  currencyCode?: string
  error?: string
}

type CreditMemoClaimItem = ClaimItem & {
  creditMemoId?: string | null
  claimNumber?: string | null
}

async function postCreditMemo(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  claimId: string,
  updatedAt?: string | null,
) {
  return apiRequest(request, 'POST', '/api/warranty_claims/credit-memo', {
    token,
    data: { claimId, ...(updatedAt !== undefined ? { updatedAt } : {}) },
  })
}

async function buildReceivedCreditClaim(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  options: {
    orderId: string
    orderLineId: string
    stamp: string
    qtyClaimed: number
    qtyApproved: number
    qtyReceived: number | null
    restockingFee?: number
  },
): Promise<CreditMemoClaimItem> {
  let claim = await createClaimFixture(request, token, {
    claimType: 'return',
    channel: 'staff',
    orderId: options.orderId,
    currencyCode: 'USD',
    lines: [
      {
        lineNo: 1,
        sku: `WC-034-${options.stamp}`,
        productName: 'QA credit-memo bridge product',
        qtyClaimed: options.qtyClaimed,
        orderLineId: options.orderLineId,
      },
    ],
  }) as CreditMemoClaimItem
  claim = await submitAndExpect(request, token, claim) as CreditMemoClaimItem
  claim = await transitionAndExpect(request, token, claim, 'in_review') as CreditMemoClaimItem
  const lines = await listClaimLines(request, token, claim.id!)
  const line = lines[0]
  expect(line, 'claim line should exist').toBeTruthy()
  const approve = await updateClaimLine(
    request,
    token,
    {
      id: line!.id,
      claimId: claim.id,
      lineStatus: 'approved',
      qtyApproved: options.qtyApproved,
      disposition: 'credit',
      ...(options.restockingFee !== undefined ? { restockingFee: options.restockingFee } : {}),
    },
    line!.updatedAt,
  )
  expect(approve.status(), 'line approval should return 200').toBe(200)
  claim = await transitionAndExpect(request, token, claim, 'approved') as CreditMemoClaimItem
  claim = await transitionAndExpect(request, token, claim, 'awaiting_return') as CreditMemoClaimItem
  claim = await transitionAndExpect(request, token, claim, 'received') as CreditMemoClaimItem
  const refreshedLines = await listClaimLines(request, token, claim.id!)
  const refreshedLine = refreshedLines[0]
  const receivePayload: Record<string, unknown> = {
    id: refreshedLine!.id,
    claimId: claim.id,
    lineStatus: 'received',
  }
  if (options.qtyReceived !== null) receivePayload.qtyReceived = options.qtyReceived
  const receive = await updateClaimLine(request, token, receivePayload, refreshedLine!.updatedAt)
  expect(receive.status(), 'line receive update should return 200').toBe(200)
  return readClaim(request, token, claim.id!) as Promise<CreditMemoClaimItem>
}

test.describe('TC-WC-034: credit-memo execution bridge', () => {
  test('rejects unauthenticated callers', async ({ request }) => {
    const response = await request.post('/api/warranty_claims/credit-memo', {
      headers: { Cookie: '' },
      data: { claimId: '00000000-0000-4000-8000-000000000000' },
    })
    expect([401, 403]).toContain(response.status())
  })

  test('mints a receipt-capped, discount-aware credit memo at a 23% tax rate and blocks duplicates', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-034')
    let orderId: string | null = null
    let claimId: string | null = null
    let creditMemoId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-034 credited line ${stamp}`,
        quantity: 4,
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRate: 23,
      })

      const lineRead = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}`, { token })
      const lineBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(lineRead)
      const sourceLine = (lineBody?.items ?? []).find((entry) => String(entry.id ?? '') === orderLineId)
      expect(sourceLine, 'the source order line should be readable via the sales API').toBeTruthy()
      const sourceGross = Number(sourceLine?.total_gross_amount ?? sourceLine?.totalGrossAmount ?? Number.NaN)
      const sourceQty = Number(sourceLine?.quantity ?? Number.NaN)
      expect(Number.isFinite(sourceGross) && sourceGross > 0, 'source line gross total should be positive').toBe(true)
      expect(sourceQty, 'source line quantity should match the fixture').toBe(4)

      const claim = await buildReceivedCreditClaim(request, token, {
        orderId,
        orderLineId,
        stamp,
        qtyClaimed: 3,
        qtyApproved: 3,
        qtyReceived: 2,
      })
      claimId = claim.id ?? null

      const expectedGross = (sourceGross * 2) / 4
      const createResponse = await postCreditMemo(request, token, claim.id!, claim.updatedAt)
      const createBody = await readJsonSafe<CreditMemoResponse>(createResponse)
      expect(createResponse.status(), `credit-memo create should return 200: ${JSON.stringify(createBody)}`).toBe(200)
      expect(createBody?.creditMemoId, 'response should include the created memo id').toBeTruthy()
      creditMemoId = createBody?.creditMemoId ?? null
      expect(createBody?.skippedLineIds ?? []).toEqual([])
      expect(createBody?.currencyCode, 'memo currency should be the order currency').toBe('USD')
      expect(
        Number(createBody?.grandTotalGrossAmount ?? Number.NaN),
        'receipt-capped credited gross should prorate the discounted line total (2 of 4 units)',
      ).toBeCloseTo(expectedGross, 4)

      const linked = await readClaim(request, token, claim.id!) as CreditMemoClaimItem
      expect(linked.creditMemoId, 'claim should be stamped with the memo id').toBe(creditMemoId)

      const memoRead = await apiRequest(request, 'GET', `/api/sales/credit-memos?id=${creditMemoId}`, { token })
      const memoBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(memoRead)
      const memo = memoBody?.items?.[0] ?? null
      expect(memo, 'the memo should be readable via the sales API').toBeTruthy()
      expect(String(memo?.reason ?? ''), 'memo reason should be the claim number (traceability)').toBe(String(linked.claimNumber ?? ''))
      const memoOrderId = String(memo?.orderId ?? memo?.order_id ?? '')
      expect(memoOrderId, 'memo should persist the order link (TC-SALES-031 flip)').toBe(orderId)
      expect(
        Number(memo?.grandTotalGrossAmount ?? memo?.grand_total_gross_amount ?? Number.NaN),
        'persisted grand total should equal the bridge-computed total',
      ).toBeCloseTo(expectedGross, 4)
      const sourceNet = Number(sourceLine?.total_net_amount ?? sourceLine?.totalNetAmount ?? Number.NaN)
      const expectedNet = (sourceNet * 2) / 4
      expect(
        Number(memo?.grandTotalNetAmount ?? memo?.grand_total_net_amount ?? Number.NaN),
        'persisted net total should equal the prorated net basis (23% pure-proration path)',
      ).toBeCloseTo(expectedNet, 4)
      expect(
        Number(memo?.taxTotalAmount ?? memo?.tax_total_amount ?? Number.NaN),
        'persisted tax total should be the exact gross-net difference',
      ).toBeCloseTo(expectedGross - expectedNet, 4)

      const duplicateResponse = await postCreditMemo(request, token, claim.id!, linked.updatedAt)
      const duplicateBody = await readJsonSafe<CreditMemoResponse>(duplicateResponse)
      expect(duplicateResponse.status(), 'second call should be rejected').toBe(400)
      expect(duplicateBody?.error ?? '').toContain('creditMemoAlreadyLinked')
    } finally {
      await cancelThenDeleteClaimIfPossible(request, token, claimId)
      if (creditMemoId) await deleteSalesEntityIfExists(request, token, '/api/sales/credit-memos', creditMemoId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('deducts restocking fees, enforces receipt evidence and status gates, and validates manual links', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-034b')
    let orderId: string | null = null
    const claimIds: Array<string | null> = []
    let feeMemoId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-034b line ${stamp}`,
        quantity: 4,
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRate: 23,
      })
      const lineRead = await apiRequest(request, 'GET', `/api/sales/order-lines?orderId=${orderId}`, { token })
      const lineBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(lineRead)
      const sourceLine = (lineBody?.items ?? []).find((entry) => String(entry.id ?? '') === orderLineId)
      const sourceGross = Number(sourceLine?.total_gross_amount ?? sourceLine?.totalGrossAmount ?? Number.NaN)

      const feeClaim = await buildReceivedCreditClaim(request, token, {
        orderId,
        orderLineId,
        stamp: `${stamp}-fee`,
        qtyClaimed: 1,
        qtyApproved: 1,
        qtyReceived: 1,
        restockingFee: 10,
      })
      claimIds.push(feeClaim.id ?? null)
      const feeExpectedGross = sourceGross / 4 - 10
      const feeResponse = await postCreditMemo(request, token, feeClaim.id!, feeClaim.updatedAt)
      const feeBody = await readJsonSafe<CreditMemoResponse>(feeResponse)
      expect(feeResponse.status(), `restocking-fee memo should return 200: ${JSON.stringify(feeBody)}`).toBe(200)
      feeMemoId = feeBody?.creditMemoId ?? null
      expect(
        Number(feeBody?.grandTotalGrossAmount ?? Number.NaN),
        'restocking fee should reduce the credited gross',
      ).toBeCloseTo(feeExpectedGross, 4)

      const notReceivedClaim = await buildReceivedCreditClaim(request, token, {
        orderId,
        orderLineId,
        stamp: `${stamp}-norecv`,
        qtyClaimed: 1,
        qtyApproved: 1,
        qtyReceived: null,
      })
      claimIds.push(notReceivedClaim.id ?? null)
      const noReceiptResponse = await postCreditMemo(request, token, notReceivedClaim.id!, notReceivedClaim.updatedAt)
      const noReceiptBody = await readJsonSafe<CreditMemoResponse>(noReceiptResponse)
      expect(noReceiptResponse.status(), `received line without qtyReceived should 400: ${JSON.stringify(noReceiptBody)}`).toBe(400)
      expect(noReceiptBody?.error ?? '').toContain('creditMemoNoEligibleLines')

      let preReceiptClaim = await createClaimFixture(request, token, {
        claimType: 'return',
        channel: 'staff',
        orderId,
        currencyCode: 'USD',
        lines: [{ lineNo: 1, sku: `WC-034-PRE-${stamp}`, productName: 'QA pre-receipt probe', qtyClaimed: 1, orderLineId }],
      }) as CreditMemoClaimItem
      claimIds.push(preReceiptClaim.id ?? null)
      preReceiptClaim = await submitAndExpect(request, token, preReceiptClaim) as CreditMemoClaimItem
      preReceiptClaim = await transitionAndExpect(request, token, preReceiptClaim, 'in_review') as CreditMemoClaimItem
      const preLines = await listClaimLines(request, token, preReceiptClaim.id!)
      const preLine = preLines[0]
      const preApprove = await updateClaimLine(
        request,
        token,
        { id: preLine!.id, claimId: preReceiptClaim.id, lineStatus: 'approved', qtyApproved: 1, disposition: 'credit' },
        preLine!.updatedAt,
      )
      expect(preApprove.status(), 'pre-receipt line approval should return 200').toBe(200)
      preReceiptClaim = await transitionAndExpect(request, token, preReceiptClaim, 'approved') as CreditMemoClaimItem
      const preReceiptResponse = await postCreditMemo(request, token, preReceiptClaim.id!, preReceiptClaim.updatedAt)
      const preReceiptBody = await readJsonSafe<CreditMemoResponse>(preReceiptResponse)
      expect(preReceiptResponse.status(), `approved (pre-receipt) claim should 400: ${JSON.stringify(preReceiptBody)}`).toBe(400)
      expect(preReceiptBody?.error ?? '').toContain('creditMemoInvalidStatus')

      const manualLinkTarget = await readClaim(request, token, preReceiptClaim.id!) as CreditMemoClaimItem
      if (feeMemoId) {
        const manualLink = await updateClaim(
          request,
          token,
          { id: manualLinkTarget.id, creditMemoId: feeMemoId },
          manualLinkTarget.updatedAt,
        )
        expect(manualLink.status(), 'manually linking an in-scope memo should return 200').toBe(200)
        const manuallyLinked = await readClaim(request, token, manualLinkTarget.id!) as CreditMemoClaimItem
        expect(manuallyLinked.creditMemoId, 'manual link should round-trip').toBe(feeMemoId)

        const badLink = await updateClaim(
          request,
          token,
          { id: manualLinkTarget.id, creditMemoId: '00000000-0000-4000-8000-00000000dead' },
          manuallyLinked.updatedAt,
        )
        expect(badLink.status(), 'linking an unknown memo id should be rejected').toBe(400)
        // Cross-scope rejection shares this code path: the reference lookup is
        // tenant/org-scoped, so a foreign-tenant memo resolves exactly like an
        // unknown id. The scoped-lookup variant is pinned at unit level in
        // credit-memo-bridge.test.ts (validateClaimReferences case).
      }
    } finally {
      for (const id of claimIds) {
        await cancelThenDeleteClaimIfPossible(request, token, id)
      }
      if (feeMemoId) await deleteSalesEntityIfExists(request, token, '/api/sales/credit-memos', feeMemoId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
