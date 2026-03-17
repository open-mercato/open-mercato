import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { GatewayPaymentLink, GatewayTransaction } from '../data/entities'
import type { PaymentGatewayService } from './gateway-service'
import { isGatewayTransactionSettled, verifyPaymentLinkAccessToken } from './payment-links'
import { readPaymentLinkStoredMetadata } from './payment-link-page-metadata'

type RequestContainer = AwilixContainer & {
  resolve(name: 'em'): EntityManager
  resolve(name: 'paymentGatewayService'): PaymentGatewayService
}

export type PublicPaymentLinkState = {
  link: GatewayPaymentLink
  transaction: GatewayTransaction
  accessGranted: boolean
  passwordRequired: boolean
  paymentLinkWidgetSpotId: string | null
  amount: number
  currencyCode: string
  pageMetadata: Record<string, unknown> | null
  customFields: Record<string, unknown> | null
  customFieldsetCode: string | null
  customerCapture: {
    enabled: boolean
    companyRequired: boolean
    collectedAt: string | null
    companyEntityId: string | null
    personEntityId: string | null
    companyName: string | null
    personName: string | null
    email: string | null
  } | null
}

export async function loadPublicPaymentLinkState({
  container,
  req,
  token,
}: {
  container: RequestContainer
  req: Request
  token: string
}): Promise<PublicPaymentLinkState | null> {
  const em = container.resolve('em')
  const link = await findOneWithDecryption(em, GatewayPaymentLink, { token, deletedAt: null })
  if (!link) return null

  const scope = { organizationId: link.organizationId, tenantId: link.tenantId }
  const transaction = await findOneWithDecryption(
    em,
    GatewayTransaction,
    { id: link.transactionId, organizationId: link.organizationId, tenantId: link.tenantId, deletedAt: null },
    undefined,
    scope,
  )
  if (!transaction) return null

  const accessToken = req.headers.get('x-payment-link-access')
  const accessGranted = !link.passwordHash || verifyPaymentLinkAccessToken(link, accessToken)
  if (link.passwordHash && !accessGranted) {
    return {
      link,
      transaction,
      accessGranted: false,
      passwordRequired: true,
      paymentLinkWidgetSpotId: null,
      amount: 0,
      currencyCode: transaction.currencyCode,
      pageMetadata: null,
      customFields: null,
      customFieldsetCode: null,
      customerCapture: null,
    }
  }

  if (!isGatewayTransactionSettled(transaction) && transaction.providerSessionId) {
    const service = container.resolve('paymentGatewayService')
    try {
      await service.getPaymentStatus(transaction.id, scope)
    } catch {
      // Public page should stay available even when provider sync fails.
    }
  }

  await em.refresh(transaction)
  if (link.status === 'active' && isGatewayTransactionSettled(transaction)) {
    link.status = 'completed'
    link.completedAt = link.completedAt ?? new Date()
    await em.flush()
  }

  const integration = getAllIntegrations().find((entry) => entry.providerKey === link.providerKey)
  const storedMetadata = readPaymentLinkStoredMetadata(link.metadata)

  return {
    link,
    transaction,
    accessGranted: true,
    passwordRequired: false,
    paymentLinkWidgetSpotId: integration?.paymentGateway?.paymentLinkWidgetSpotId ?? null,
    amount: typeof storedMetadata.amount === 'number' ? storedMetadata.amount : Number(transaction.amount),
    currencyCode: storedMetadata.currencyCode ?? transaction.currencyCode,
    pageMetadata: storedMetadata.pageMetadata ?? null,
    customFields: storedMetadata.customFields ?? null,
    customFieldsetCode: storedMetadata.customFieldsetCode ?? null,
    customerCapture: storedMetadata.customerCapture?.enabled
      ? {
          enabled: true,
          companyRequired: storedMetadata.customerCapture.companyRequired === true,
          collectedAt: storedMetadata.customerCapture.collectedAt ?? null,
          companyEntityId: storedMetadata.customerCapture.companyEntityId ?? null,
          personEntityId: storedMetadata.customerCapture.personEntityId ?? null,
          companyName: storedMetadata.customerCapture.companyName ?? null,
          personName: storedMetadata.customerCapture.personName ?? null,
          email: storedMetadata.customerCapture.email ?? null,
        }
      : null,
  }
}
