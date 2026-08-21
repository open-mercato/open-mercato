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
  cleanupDraftClaimWithLines,
  createClaimFixture,
  createClaimLine,
  listClaimLines,
  readClaim,
  readWarrantyClaimRisk,
  uniqueLabel,
} from './helpers'

function claimBody(orderId: string, stamp: string, lines: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    claimType: 'return',
    channel: 'staff',
    orderId,
    currencyCode: 'USD',
    lines: lines.map((line, index) => ({
      lineNo: index + 1,
      sku: `WC-031-${stamp}-${index + 1}`,
      productName: 'QA over-claim guard product',
      ...line,
    })),
  }
}

test.describe('TC-WC-031: over-claim quantity guards', () => {
  test('hard-gates claimed quantity against the sold order-line quantity on every write path', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-031')
    let orderId: string | null = null
    let claimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-031 sold line ${stamp}`,
        quantity: 2,
      })

      const inlineOverResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token,
        data: claimBody(orderId, `${stamp}-inline`, [{ orderLineId, qtyClaimed: 3 }]),
      })
      const inlineOverBody = await readJsonSafe<{ error?: string }>(inlineOverResponse)
      expect(inlineOverResponse.status(), `inline over-claim should 400: ${JSON.stringify(inlineOverBody)}`).toBe(400)
      expect(inlineOverBody?.error ?? '').toContain('qtyExceedsOrdered')

      const duplicateRowsResponse = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token,
        data: claimBody(orderId, `${stamp}-dup`, [
          { orderLineId, qtyClaimed: 1 },
          { orderLineId, qtyClaimed: 2 },
        ]),
      })
      const duplicateRowsBody = await readJsonSafe<{ error?: string }>(duplicateRowsResponse)
      expect(duplicateRowsResponse.status(), `same-claim duplicate rows summing over sold should 400: ${JSON.stringify(duplicateRowsBody)}`).toBe(400)
      expect(duplicateRowsBody?.error ?? '').toContain('qtyExceedsOrdered')

      const claim = await createClaimFixture(request, token, claimBody(orderId, stamp, [{ orderLineId, qtyClaimed: 1 }]))
      claimId = claim.id ?? null

      const lineOverResponse = await createClaimLine(request, token, {
        claimId: claim.id,
        lineNo: 2,
        sku: `WC-031-${stamp}-append`,
        productName: 'QA over-claim appended line',
        orderLineId,
        qtyClaimed: 2,
      }, claim.updatedAt)
      const lineOverBody = await readJsonSafe<{ error?: string }>(lineOverResponse)
      expect(lineOverResponse.status(), `appending a line that pushes the claim over sold qty should 400: ${JSON.stringify(lineOverBody)}`).toBe(400)
      expect(lineOverBody?.error ?? '').toContain('qtyExceedsOrdered')

      const withinResponse = await createClaimLine(request, token, {
        claimId: claim.id,
        lineNo: 2,
        sku: `WC-031-${stamp}-ok`,
        productName: 'QA within-quota appended line',
        orderLineId,
        qtyClaimed: 1,
      }, (await readClaim(request, token, claim.id!)).updatedAt)
      expect(withinResponse.status(), 'appending within the sold quantity should succeed').toBe(201)
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('does not apply the sold-quantity gate to lines without an order-line reference', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-031-unlinked')
    let orderId: string | null = null
    let claimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)

      const response = await apiRequest(request, 'POST', '/api/warranty_claims', {
        token,
        data: claimBody(orderId, stamp, [{ qtyClaimed: 999_999_999 }]),
      })
      const body = await readJsonSafe<{ id?: string | null }>(response)
      expect(response.status(), `unlinked high-quantity line should succeed: ${JSON.stringify(body)}`).toBe(201)
      claimId = body?.id ?? null
      expect(claimId, 'created claim should include an id').toBeTruthy()
    } finally {
      await cleanupDraftClaimWithLines(request, token, claimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })

  test('surfaces cross-claim cumulative over-claiming as an advisory risk signal', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueLabel('tc-wc-031b')
    let orderId: string | null = null
    let firstClaimId: string | null = null
    let secondClaimId: string | null = null

    try {
      if (!(await canManageSalesOrders(request, token))) {
        test.skip(true, 'sales order management is unavailable for the admin role on this database')
      }
      orderId = await createSalesOrderFixture(request, token)
      const orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `WC-031b sold line ${stamp}`,
        quantity: 2,
      })

      const first = await createClaimFixture(request, token, claimBody(orderId, `${stamp}-a`, [{ orderLineId, qtyClaimed: 2 }]))
      firstClaimId = first.id ?? null
      const second = await createClaimFixture(request, token, claimBody(orderId, `${stamp}-b`, [{ orderLineId, qtyClaimed: 1 }]))
      secondClaimId = second.id ?? null

      const risk = await readWarrantyClaimRisk(request, token, second.id!)
      const overSignal = risk.signals.find((signal) => signal.id === 'over_quantity_claim')
      expect(overSignal, `risk response should include over_quantity_claim: ${JSON.stringify(risk.signals)}`).toBeTruthy()

      const firstLines = await listClaimLines(request, token, first.id!)
      expect(firstLines.length, 'first claim keeps its line (advisory tier never blocks)').toBe(1)
    } finally {
      await cleanupDraftClaimWithLines(request, token, secondClaimId)
      await cleanupDraftClaimWithLines(request, token, firstClaimId)
      if (orderId) await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
    }
  })
})
