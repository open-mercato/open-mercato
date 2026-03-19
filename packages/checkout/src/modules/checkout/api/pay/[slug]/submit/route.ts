import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutLink, CheckoutTransaction } from '../../../../data/entities'
import { publicSubmitSchema } from '../../../../data/validators'
import { handleCheckoutRouteError, requireCheckoutPasswordSession } from '../../../helpers'
import {
  buildConsentProof,
  mapGatewayStatusToCheckoutStatus,
  resolveSubmittedAmount,
  validateDescriptorCurrencies,
} from '../../../../lib/utils'
import { checkoutTag } from '../../../openapi'

const IDEMPOTENCY_CACHE_KEY = '__openMercatoCheckoutIdempotency__'

type CachedSubmitResponse = {
  transactionId: string
  redirectUrl?: string | null
  embeddedFormData?: Record<string, unknown> | null
}

function getIdempotencyCache(): Map<string, CachedSubmitResponse> {
  const globalState = globalThis as typeof globalThis & {
    [IDEMPOTENCY_CACHE_KEY]?: Map<string, CachedSubmitResponse>
  }
  if (!globalState[IDEMPOTENCY_CACHE_KEY]) {
    globalState[IDEMPOTENCY_CACHE_KEY] = new Map()
  }
  return globalState[IDEMPOTENCY_CACHE_KEY]
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
    const cacheKey = `${resolvedParams.slug}:${idempotencyKey}`
    const cache = getIdempotencyCache()
    const cached = cache.get(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const body = publicSubmitSchema.parse(await req.json().catch(() => ({})))
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const commandBus = container.resolve('commandBus') as CommandBus
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const link = await em.findOne(CheckoutLink, {
      slug: resolvedParams.slug,
      deletedAt: null,
      isActive: true,
    })
    if (!link) {
      return NextResponse.json({ error: 'Payment link not found' }, { status: 404 })
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

    const transactionInput = {
      linkId: link.id,
      amount: resolvedAmount.amount,
      currencyCode: resolvedAmount.currencyCode,
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
    const created = await commandBus.execute<typeof transactionInput, { id: string }>('checkout.transaction.create', {
      input: transactionInput,
      ctx,
    })
    const transactionId = created.result.id
    const requestUrl = new URL(req.url)
    const successUrl = `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/success/${encodeURIComponent(transactionId)}`
    const cancelUrl = `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/cancel/${encodeURIComponent(transactionId)}`
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
    const transaction = await em.findOne(CheckoutTransaction, {
      id: transactionId,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    })
    if (transaction) {
      transaction.gatewayTransactionId = sessionResult.transaction.id
      transaction.paymentStatus = sessionResult.transaction.unifiedStatus
      transaction.status = mapGatewayStatusToCheckoutStatus(sessionResult.transaction.unifiedStatus)
      await em.flush()
    }
    const responsePayload: CachedSubmitResponse = {
      transactionId,
      redirectUrl: sessionResult.session.redirectUrl ?? null,
      embeddedFormData: sessionResult.session.clientSecret
        ? {
          clientSecret: sessionResult.session.clientSecret,
          providerKey: link.gatewayProviderKey,
          gatewayTransactionId: sessionResult.transaction.id,
        }
        : null,
    }
    cache.set(cacheKey, responsePayload)
    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default POST
