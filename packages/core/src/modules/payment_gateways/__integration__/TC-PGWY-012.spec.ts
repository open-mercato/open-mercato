import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  assignTransaction,
  createPaymentSession,
  deassignTransaction,
  getTransactionDetails,
  listTransactions,
} from './helpers/fixtures'

/**
 * TC-PGWY-012: Transaction tracking list and detail APIs
 *
 * Payment-link enrichment tests live in packages/pay-by-links (decoupled via interceptor).
 */
test.describe('TC-PGWY-012: Transaction tracking APIs', () => {
  test('should list transactions and expose transaction-scoped details with logs', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 64.25,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    const list = await listTransactions(request, token)
    expect(list.total).toBeGreaterThan(0)
    expect(list.items.some((item) => item.id === session.transactionId)).toBe(true)

    const detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.id).toBe(session.transactionId)
    expect(detail.transaction.paymentId).toBe(session.paymentId)
    expect(detail.logs.some((log) => log.message === 'Payment session created')).toBe(true)
  })

  test('should filter transactions by assignment entity type and entity id', async ({ request }) => {
    const token = await getAuthToken(request)
    const sharedEntityId = `order-${Date.now()}`
    const secondaryEntityId = `invoice-${Date.now()}`
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 81.15,
      currencyCode: 'USD',
      captureMethod: 'manual',
      assignments: [
        { entityType: 'sales:sales_order', entityId: sharedEntityId },
        { entityType: 'sales:sales_invoice', entityId: secondaryEntityId },
      ],
    })

    const filteredList = await listTransactions(request, token, {
      entityType: 'sales:sales_order',
      entityId: sharedEntityId,
    })
    expect(filteredList.items.some((item) => item.id === session.transactionId)).toBe(true)

    const detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'sales:sales_order', entityId: sharedEntityId }),
        expect.objectContaining({ entityType: 'sales:sales_invoice', entityId: secondaryEntityId }),
      ]),
    )
  })

  test('should allow adding and removing transaction assignments after session creation', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 40.5,
      currencyCode: 'USD',
      captureMethod: 'manual',
    })

    await assignTransaction(request, token, session.transactionId, {
      entityType: 'sales:sales_order',
      entityId: `order-${Date.now()}`,
    })
    await assignTransaction(request, token, session.transactionId, {
      entityType: 'sales:sales_invoice',
      entityId: `invoice-${Date.now()}`,
    })

    let detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.assignments).toHaveLength(2)

    await deassignTransaction(request, token, session.transactionId, {
      entityType: detail.transaction.assignments[0]?.entityType ?? '',
      entityId: detail.transaction.assignments[0]?.entityId ?? '',
    })

    detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.assignments).toHaveLength(1)
  })

  test('should not duplicate a transaction when filtering by an entity type shared across assignments', async ({ request }) => {
    const token = await getAuthToken(request)
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 72.75,
      currencyCode: 'USD',
      captureMethod: 'manual',
      assignments: [
        { entityType: 'sales:sales_order', entityId: `order-a-${Date.now()}` },
        { entityType: 'sales:sales_order', entityId: `order-b-${Date.now()}` },
      ],
    })

    const filteredList = await listTransactions(request, token, {
      entityType: 'sales:sales_order',
    })

    const matchingItems = filteredList.items.filter((item) => item.id === session.transactionId)
    expect(filteredList.total).toBeGreaterThan(0)
    expect(matchingItems).toHaveLength(1)
  })

  test('should map deprecated document filters into transaction assignments', async ({ request }) => {
    const token = await getAuthToken(request)
    const legacyEntityId = `legacy-link-${Date.now()}`
    const session = await createPaymentSession(request, token, {
      providerKey: 'mock',
      amount: 22.5,
      currencyCode: 'USD',
      captureMethod: 'manual',
      documentType: 'payment_link_pages:gateway_payment_link',
      documentId: legacyEntityId,
    })

    const filteredList = await listTransactions(request, token, {
      entityType: 'payment_link_pages:gateway_payment_link',
      entityId: legacyEntityId,
    })
    expect(filteredList.items.some((item) => item.id === session.transactionId)).toBe(true)

    const detail = await getTransactionDetails(request, token, session.transactionId)
    expect(detail.transaction.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'payment_link_pages:gateway_payment_link',
          entityId: legacyEntityId,
        }),
      ]),
    )
  })
})
