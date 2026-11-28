import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CheckoutLink, CheckoutTransaction } from '../data/entities'
import {
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  findGatewayTransactionIdForCheckout,
  readCheckoutTransaction,
  readGatewayTransaction,
  sendMockGatewayWebhook,
  submitPayLink,
} from './helpers/fixtures'

test.describe('TC-CHKT-048: late gateway capture after checkout expiry', () => {
  test('refunds a captured payment when its checkout transaction is already expired', async ({ request }) => {
    let token: string | null = null
    let linkId: string | null = null

    try {
      token = await getAuthToken(request)
      const link = await createLinkFixture(request, token, {
        ...createFixedTemplateInput({ status: 'active', collectCustomerDetails: false }),
        maxCompletions: 1,
      })
      linkId = link.id

      const submit = await submitPayLink(request, link.slug, {
        customerData: {},
        acceptedLegalConsents: {},
        amount: 49.99,
      })
      expect(submit.status()).toBe(201)
      const { transactionId } = await readJsonSafe<{ transactionId: string }>(submit) ?? { transactionId: '' }
      expect(transactionId).toBeTruthy()

      const gatewayTransactionId = await findGatewayTransactionIdForCheckout(request, token, transactionId)
      const gatewayTransaction = await readGatewayTransaction(request, token, gatewayTransactionId)
      expect(gatewayTransaction.providerSessionId).toBeTruthy()

      const container = await createRequestContainer()
      const em = (container.resolve('em') as EntityManager).fork()
      const checkoutRecord = await em.findOne(CheckoutTransaction, { id: transactionId })
      expect(checkoutRecord).toBeTruthy()
      const expiredRows = await em.nativeUpdate(
        CheckoutTransaction,
        {
          id: transactionId,
          organizationId: checkoutRecord!.organizationId,
          tenantId: checkoutRecord!.tenantId,
        },
        { status: 'expired', paymentStatus: 'expired' },
      )
      expect(expiredRows).toBe(1)
      await em.nativeUpdate(
        CheckoutLink,
        {
          id: checkoutRecord!.linkId,
          organizationId: checkoutRecord!.organizationId,
          tenantId: checkoutRecord!.tenantId,
        },
        { activeReservationCount: 0, isLocked: false },
      )

      const webhook = await sendMockGatewayWebhook(
        request,
        token,
        gatewayTransaction.providerSessionId!,
        'captured',
        49.99,
      )
      expect(webhook.ok(), `Captured webhook failed: ${webhook.status()} ${await webhook.text()}`).toBeTruthy()

      let updatedGatewayTransaction = gatewayTransaction
      for (let attempt = 0; attempt < 30 && updatedGatewayTransaction.unifiedStatus !== 'refunded'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        updatedGatewayTransaction = await readGatewayTransaction(request, token, gatewayTransactionId)
      }

      expect(updatedGatewayTransaction.unifiedStatus).toBe('refunded')
      const checkoutTransaction = await readCheckoutTransaction(request, token, transactionId)
      expect(checkoutTransaction.status).toBe('expired')
      expect(checkoutTransaction.paymentStatus).toBe('refunded')
    } finally {
      await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
    }
  })
})
