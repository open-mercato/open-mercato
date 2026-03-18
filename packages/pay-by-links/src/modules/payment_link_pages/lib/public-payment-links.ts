import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { GatewayPaymentLink } from '../data/entities'
import { GatewayTransaction } from '@open-mercato/core/modules/payment_gateways/data/entities'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { verifyPaymentLinkAccessToken } from './payment-links'
import { readPaymentLinkStoredMetadata } from './payment-link-page-metadata'
import type { CustomerHandlingMode } from './payment-link-page-metadata'

function isGatewayTransactionSettled(transaction: GatewayTransaction): boolean {
  return ['authorized', 'captured', 'partially_captured', 'refunded', 'partially_refunded'].includes(transaction.unifiedStatus)
}

type RequestContainer = AwilixContainer & {
  resolve(name: 'em'): EntityManager
  resolve(name: 'paymentGatewayService'): PaymentGatewayService
}

export type PublicPaymentLinkState = {
  link: GatewayPaymentLink
  transaction: GatewayTransaction | null
  accessGranted: boolean
  passwordRequired: boolean
  requiresSessionCreation: boolean
  paymentLinkWidgetSpotId: string | null
  amount: number
  currencyCode: string
  pageMetadata: Record<string, unknown> | null
  customFields: Record<string, unknown> | null
  customFieldsetCode: string | null
  customerCapture: {
    enabled: boolean
    companyRequired: boolean
    termsRequired: boolean
    termsMarkdown: string | null
    customerHandlingMode: CustomerHandlingMode
    collectedAt: string | null
    termsAcceptedAt: string | null
    companyEntityId: string | null
    personEntityId: string | null
    companyName: string | null
    personName: string | null
    email: string | null
    customerCreated: boolean
    fields: Record<string, { visible?: boolean; required?: boolean }> | null
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
  const isMultiUseLink = link.linkMode === 'multi'

  let transaction: GatewayTransaction | null = null
  if (link.transactionId) {
    transaction = await findOneWithDecryption(
      em,
      GatewayTransaction,
      { id: link.transactionId, organizationId: link.organizationId, tenantId: link.tenantId, deletedAt: null },
      undefined,
      scope,
    )
    if (!transaction && !isMultiUseLink) return null
  } else if (!isMultiUseLink) {
    return null
  }

  const storedMetadata = readPaymentLinkStoredMetadata(link.metadata)

  const accessToken = req.headers.get('x-payment-link-access')
  const accessGranted = !link.passwordHash || verifyPaymentLinkAccessToken(link, accessToken)
  if (link.passwordHash && !accessGranted) {
    return {
      link,
      transaction,
      accessGranted: false,
      passwordRequired: true,
      requiresSessionCreation: false,
      paymentLinkWidgetSpotId: null,
      amount: 0,
      currencyCode: transaction?.currencyCode ?? storedMetadata.currencyCode ?? '',
      pageMetadata: null,
      customFields: null,
      customFieldsetCode: null,
      customerCapture: null,
    }
  }

  if (transaction && !isGatewayTransactionSettled(transaction) && transaction.providerSessionId) {
    const service = container.resolve('paymentGatewayService')
    try {
      await service.getPaymentStatus(transaction.id, scope)
    } catch {
      // Public page should stay available even when provider sync fails.
    }
  }

  if (transaction) {
    await em.refresh(transaction)
    if (link.status === 'active' && isGatewayTransactionSettled(transaction)) {
      link.status = 'completed'
      link.completedAt = link.completedAt ?? new Date()
      await em.flush()
    }
  }

  const integration = getAllIntegrations().find((entry) => entry.providerKey === link.providerKey)
  const requiresSessionCreation = isMultiUseLink && !transaction

  const amount = typeof storedMetadata.amount === 'number'
    ? storedMetadata.amount
    : (transaction ? Number(transaction.amount) : 0)
  const currencyCode = storedMetadata.currencyCode ?? (transaction?.currencyCode ?? '')

  return {
    link,
    transaction,
    accessGranted: true,
    passwordRequired: false,
    requiresSessionCreation,
    paymentLinkWidgetSpotId: integration?.paymentGateway?.paymentLinkWidgetSpotId ?? null,
    amount,
    currencyCode,
    pageMetadata: storedMetadata.pageMetadata ?? null,
    customFields: storedMetadata.customFields ?? null,
    customFieldsetCode: storedMetadata.customFieldsetCode ?? null,
    customerCapture: storedMetadata.customerCapture?.enabled
      ? {
          enabled: true,
          companyRequired: storedMetadata.customerCapture.companyRequired === true,
          termsRequired: storedMetadata.customerCapture.termsRequired === true,
          termsMarkdown: storedMetadata.customerCapture.termsMarkdown ?? null,
          customerHandlingMode: storedMetadata.customerCapture.customerHandlingMode ?? 'no_customer',
          collectedAt: storedMetadata.customerCapture.collectedAt ?? null,
          termsAcceptedAt: storedMetadata.customerCapture.termsAcceptedAt ?? null,
          companyEntityId: storedMetadata.customerCapture.companyEntityId ?? null,
          personEntityId: storedMetadata.customerCapture.personEntityId ?? null,
          companyName: storedMetadata.customerCapture.companyName ?? null,
          personName: storedMetadata.customerCapture.personName ?? null,
          email: storedMetadata.customerCapture.email ?? null,
          customerCreated: storedMetadata.customerCapture.customerCreated === true,
          fields: storedMetadata.customerCapture.fields ?? null,
        }
      : null,
  }
}
