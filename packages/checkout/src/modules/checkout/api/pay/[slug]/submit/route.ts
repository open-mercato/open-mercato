import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { GatewayTransaction } from '@open-mercato/core/modules/payment_gateways/data/entities'
import { CheckoutLink, CheckoutTransaction } from '../../../../data/entities'
import { publicSubmitSchema } from '../../../../data/validators'
import { handleCheckoutRouteError, requireCheckoutPasswordSession } from '../../../helpers'
import { emitCheckoutEvent } from '../../../../events'
import {
  buildConsentProof,
  isCheckoutLinkPublic,
  mapGatewayStatusToCheckoutStatus,
  resolveSubmittedAmount,
  validateDescriptorCurrencies,
} from '../../../../lib/utils'
import { checkoutTag } from '../../../openapi'

type CachedSubmitResponse = {
  transactionId: string
  redirectUrl?: string | null
  embeddedFormData?: Record<string, unknown> | null
}

function isIdempotencyConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return message.includes('checkout_transactions_organization_id_tenant_id_link_idempotency_key_index')
    || message.includes('checkout_transactions_organization_id_tenant_id_link_idempotency_key_unique')
    || message.includes('duplicate key value')
}

async function buildSubmitResponse(
  em: EntityManager,
  transaction: CheckoutTransaction,
  providerKey: string | null | undefined,
): Promise<CachedSubmitResponse> {
  const gatewayTransaction = transaction.gatewayTransactionId
    ? await em.findOne(GatewayTransaction, {
      id: transaction.gatewayTransactionId,
      organizationId: transaction.organizationId,
      tenantId: transaction.tenantId,
      deletedAt: null,
    })
    : null
  return {
    transactionId: transaction.id,
    redirectUrl: gatewayTransaction?.redirectUrl ?? null,
    embeddedFormData: gatewayTransaction?.clientSecret
      ? {
        clientSecret: gatewayTransaction.clientSecret,
        providerKey: providerKey ?? null,
        gatewayTransactionId: gatewayTransaction.id,
      }
      : null,
  }
}

export const metadata = {
  path: '/checkout/pay/[slug]/submit',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const resolvedParams = await params
    const idempotencyKey = req.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required' }, { status: 400 })
    }

    const body = publicSubmitSchema.parse(await req.json().catch(() => ({})))
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const commandBus = container.resolve('commandBus') as CommandBus
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
    })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
    }
    if (!isCheckoutLinkPublic(link.status)) {
      throw new CrudHttpError(422, { error: 'This payment link is not currently accepting payments' })
    }
    if (link.passwordHash) {
      requireCheckoutPasswordSession(req, link.slug)
    }
    if (!link.gatewayProviderKey) {
      throw new CrudHttpError(422, { error: 'A payment gateway must be configured before this link can be used' })
    }
    for (const key of ['terms', 'privacyPolicy'] as const) {
      const document = (link.legalDocuments ?? {})[key]
      if (document?.required === true && body.acceptedLegalConsents?.[key] !== true) {
        throw new CrudHttpError(422, { error: `Acceptance is required for ${key}` })
      }
    }
    for (const field of link.customerFieldsSchema ?? []) {
      if (field.required !== true) continue
      const value = body.customerData?.[field.key]
      if (value == null || `${value}`.trim().length === 0) {
        throw new CrudHttpError(422, { error: `Field ${field.key} is required` })
      }
    }
    const resolvedAmount = resolveSubmittedAmount(link, body)
    validateDescriptorCurrencies(link.gatewayProviderKey, [resolvedAmount.currencyCode])
    const existingTransaction = await em.findOne(CheckoutTransaction, {
      linkId: link.id,
      idempotencyKey,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })
    if (existingTransaction?.gatewayTransactionId) {
      return NextResponse.json(
        await buildSubmitResponse(em, existingTransaction, link.gatewayProviderKey),
      )
    }

    const transactionInput = {
      linkId: link.id,
      amount: resolvedAmount.amount,
      currencyCode: resolvedAmount.currencyCode,
      idempotencyKey,
      customerData: body.customerData,
      firstName: typeof body.customerData.firstName === 'string' ? body.customerData.firstName : null,
      lastName: typeof body.customerData.lastName === 'string' ? body.customerData.lastName : null,
      email: typeof body.customerData.email === 'string' ? body.customerData.email : null,
      phone: typeof body.customerData.phone === 'string' ? body.customerData.phone : null,
      selectedPriceItemId: resolvedAmount.selectedPriceItemId,
      acceptedLegalConsents: buildConsentProof(link, body.acceptedLegalConsents),
      ipAddress: req.headers.get('x-forwarded-for') ?? null,
      userAgent: req.headers.get('user-agent') ?? null,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    }
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: link.organizationId,
      organizationIds: [link.organizationId],
      request: req,
    }
    let transactionId = existingTransaction?.id ?? null
    if (!transactionId) {
      try {
        const created = await commandBus.execute<typeof transactionInput, { id: string }>('checkout.transaction.create', {
          input: transactionInput,
          ctx,
        })
        transactionId = created.result.id
      } catch (error) {
        if (!isIdempotencyConflict(error)) {
          throw error
        }
        const duplicated = await em.findOne(CheckoutTransaction, {
          linkId: link.id,
          idempotencyKey,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        })
        if (!duplicated) {
          throw error
        }
        transactionId = duplicated.id
      }
    }
    if (!transactionId) {
      throw new CrudHttpError(500, { error: 'Failed to initialize checkout transaction' })
    }
    const requestUrl = new URL(req.url)
    const successUrl = `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/success/${encodeURIComponent(transactionId)}`
    const cancelUrl = `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/cancel/${encodeURIComponent(transactionId)}`
    const transaction = await em.findOne(CheckoutTransaction, {
      id: transactionId,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })
    if (!transaction) {
      throw new CrudHttpError(404, { error: 'Transaction not found' })
    }
    if (!transaction.gatewayTransactionId) {
      const sessionResult = await paymentGatewayService.createPaymentSession({
        providerKey: link.gatewayProviderKey,
        paymentId: transactionId,
        amount: resolvedAmount.amount,
        currencyCode: resolvedAmount.currencyCode,
        description: link.title ?? link.name,
        successUrl,
        cancelUrl,
        metadata: {
          checkoutLinkId: link.id,
          checkoutSlug: link.slug,
        },
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      })
      transaction.gatewayTransactionId = sessionResult.transaction.id
      transaction.paymentStatus = sessionResult.transaction.unifiedStatus
      transaction.status = mapGatewayStatusToCheckoutStatus(sessionResult.transaction.unifiedStatus)
      await em.flush()
      await emitCheckoutEvent('checkout.transaction.sessionStarted', {
        transactionId: transaction.id,
        linkId: transaction.linkId,
        slug: link.slug,
        status: transaction.status,
        paymentStatus: transaction.paymentStatus ?? null,
        amount: Number(transaction.amount),
        currency: transaction.currencyCode,
        gatewayProvider: link.gatewayProviderKey,
        gatewayTransactionId: transaction.gatewayTransactionId,
        occurredAt: new Date().toISOString(),
        tenantId: link.tenantId,
        organizationId: link.organizationId,
      }).catch(() => undefined)
    }
    return NextResponse.json(await buildSubmitResponse(em, transaction, link.gatewayProviderKey), { status: 201 })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default POST
