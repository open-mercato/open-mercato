import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  getAuthToken,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerData,
  createFixedTemplateInput,
  createLinkFixture,
  deleteCheckoutEntityIfExists,
  findGatewayTransactionIdForCheckout,
  readCheckoutTransaction,
  readGatewayTransaction,
  sendMockGatewayWebhook,
  submitPayLink,
  waitForCheckoutStatus,
} from './helpers/fixtures'

test.describe('TC-CHKT-019: Gateway event updates checkout transaction status', () => {
  test('fails the initiating checkout and preserves a pending checkout in another organization', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    const label = `checkout-webhook-${randomUUID()}`
    const password = `Qa-${randomUUID()}-Aa1!`
    const organizationIds: string[] = []
    const userIds: string[] = []
    const links: Array<{ token: string; linkId: string }> = []
    let roleId: string | null = null

    try {
      for (const suffix of ['initiating', 'other']) {
        organizationIds.push(await createOrganizationFixture(request, superadminToken, {
          tenantId,
          name: `${label}-${suffix}`,
        }))
      }
      roleId = await createRoleFixture(request, superadminToken, { tenantId, name: label })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        organizations: organizationIds,
        features: ['checkout.create', 'checkout.view', 'checkout.delete', 'payment_gateways.view'],
      })

      const checkouts: Array<{ token: string; transactionId: string }> = []
      for (const organizationId of organizationIds) {
        const email = `${label}-${userIds.length}@example.test`
        userIds.push(await createUserFixture(request, superadminToken, {
          email,
          password,
          organizationId,
          roles: [roleId],
        }))
        const token = await getAuthToken(request, email, password)
        expect(getTokenContext(token)).toEqual({ tenantId, organizationId })
        const link = await createLinkFixture(request, token, createFixedTemplateInput({
          status: 'active',
          gatewayProviderKey: 'mock_processing',
        }))
        links.push({ token, linkId: link.id })

        const submitResponse = await submitPayLink(request, link.slug, {
          customerData: createCustomerData(),
          acceptedLegalConsents: {},
          amount: 49.99,
        })
        expect(submitResponse.status()).toBe(201)
        const submitBody = await readJsonSafe<{ transactionId?: string }>(submitResponse)
        const transactionId = expectId(submitBody?.transactionId, 'Checkout submit should return a transaction ID')
        checkouts.push({ token, transactionId })
      }
      const [
        { token: initiatingToken, transactionId: initiatingTransactionId },
        { token: otherToken, transactionId: otherTransactionId },
      ] = checkouts
      const originalOtherTransaction = await readCheckoutTransaction(request, otherToken, otherTransactionId)
      expect(originalOtherTransaction).toMatchObject({
        id: otherTransactionId,
        status: 'processing',
        paymentStatus: 'pending',
      })

      const gatewayTransactionId = await findGatewayTransactionIdForCheckout(request, initiatingToken, initiatingTransactionId)
      const gatewayTransaction = await readGatewayTransaction(request, initiatingToken, gatewayTransactionId)
      const providerSessionId = expectId(gatewayTransaction.providerSessionId, 'Gateway transaction should have a provider session ID')

      const webhookResponse = await sendMockGatewayWebhook(
        request,
        initiatingToken,
        providerSessionId,
        'failed',
        49.99,
        { providerKey: 'mock_processing' },
      )
      expect(webhookResponse.status()).toBe(202)

      const transaction = await waitForCheckoutStatus(request, initiatingToken, initiatingTransactionId, 'failed')
      expect(transaction.status).toBe('failed')
      expect(transaction.paymentStatus).toBe('failed')
      expect(await readCheckoutTransaction(request, otherToken, otherTransactionId))
        .toEqual(originalOtherTransaction)
    } finally {
      try {
        if (links.length > 0) {
          await withClient(async (client) => {
            const scope = [tenantId, organizationIds]
            await client.query('delete from gateway_webhook_events where tenant_id = $1 and organization_id = any($2::uuid[])', scope)
            await client.query('delete from gateway_session_initializations where tenant_id = $1 and organization_id = any($2::uuid[])', scope)
            await client.query('delete from checkout_transactions where tenant_id = $1 and organization_id = any($2::uuid[])', scope)
            await client.query('delete from gateway_transactions where tenant_id = $1 and organization_id = any($2::uuid[])', scope)
          })
        }
      } finally {
        for (const { token, linkId } of links) {
          await deleteCheckoutEntityIfExists(request, token, 'links', linkId)
        }
        for (const userId of userIds) {
          await deleteUserIfExists(request, superadminToken, userId)
        }
        await deleteRoleIfExists(request, superadminToken, roleId)
        for (const organizationId of organizationIds) {
          await deleteOrganizationIfExists(request, superadminToken, organizationId)
        }
      }
    }
  })
})
