import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { checkRateLimit, getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { PaymentGatewayClientSession } from '@open-mercato/shared/modules/payment_gateways/types'
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
import { validateCheckoutCustomerData } from '../../../../lib/customerDataValidation'
import { checkoutSubmitRateLimitConfig } from '../../../../lib/rateLimiter'
import { checkoutTag } from '../../../openapi'

type CachedSubmitResponse = {
  transactionId: string
  redirectUrl?: string | null
  paymentSession?: (PaymentGatewayClientSession & {
    providerKey: string | null
    gatewayTransactionId: string
  }) | null
}

type CheckoutLegalDocumentRequirement = {
  required?: boolean
}

type CheckoutCustomerFieldRequirement = {
  key: string
  required?: boolean
}

function normalizePort(url: URL): string {
  if (url.port) return url.port
  return url.protocol === 'https:' ? '443' : '80'
}

function normalizeConfiguredOrigin(candidate: string): string | null {
  try {
    return new URL(candidate).origin
  } catch {
    return null
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

function splitHeaderValues(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isAllowedRequestOrigin(submittedOrigin: string, allowedOrigin: string): boolean {
  if (submittedOrigin === allowedOrigin) return true
  try {
    const submittedUrl = new URL(submittedOrigin)
    const allowedUrl = new URL(allowedOrigin)
    return submittedUrl.protocol === allowedUrl.protocol
      && normalizePort(submittedUrl) === normalizePort(allowedUrl)
      && isLoopbackHostname(submittedUrl.hostname)
      && isLoopbackHostname(allowedUrl.hostname)
  } catch {
    return false
  }
}

const CONFIGURED_ALLOWED_ORIGINS: string[] = (process.env.CHECKOUT_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

function addAllowedOrigin(allowedOrigins: Set<string>, candidate: string) {
  const normalized = normalizeConfiguredOrigin(candidate)
  if (!normalized) return
  allowedOrigins.add(normalized)
  try {
    const parsed = new URL(normalized)
    if (!isLoopbackHostname(parsed.hostname)) return
    for (const hostname of ['127.0.0.1', 'localhost']) {
      for (const protocol of ['http:', 'https:']) {
        const variant = new URL(normalized)
        variant.hostname = hostname
        variant.protocol = protocol
        allowedOrigins.add(variant.origin)
      }
    }
  } catch {
    // Ignore invalid variants.
  }
}

function buildAllowedOrigins(req: Request): string[] {
  const requestUrl = new URL(req.url)
  const allowedOrigins = new Set<string>()
  addAllowedOrigin(allowedOrigins, requestUrl.origin)

  for (const origin of CONFIGURED_ALLOWED_ORIGINS) {
    addAllowedOrigin(allowedOrigins, origin)
  }
  for (const origin of [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (origin) addAllowedOrigin(allowedOrigins, origin)
  }

  const hostCandidates = [
    ...splitHeaderValues(req.headers.get('x-forwarded-host')),
    ...splitHeaderValues(req.headers.get('host')),
  ]
  const protoCandidates = new Set<string>([
    ...splitHeaderValues(req.headers.get('x-forwarded-proto')),
    requestUrl.protocol.replace(/:$/, ''),
  ])

  for (const host of hostCandidates) {
    for (const proto of protoCandidates) {
      addAllowedOrigin(allowedOrigins, `${proto}://${host}`)
    }
  }

  return Array.from(allowedOrigins)
}

function isIdempotencyConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return message.includes('checkout_transactions_organization_id_tenant_id_link_idempotency_key_index')
    || message.includes('checkout_transactions_organization_id_tenant_id_link_idempotency_key_unique')
    || message.includes('duplicate key value')
}

function readClientSession(
  metadata: Record<string, unknown> | null | undefined,
): PaymentGatewayClientSession | null {
  const candidate = metadata?.clientSession
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const type = (candidate as { type?: unknown }).type
  if (type === 'redirect') {
    const redirectUrl = (candidate as { redirectUrl?: unknown }).redirectUrl
    if (typeof redirectUrl !== 'string' || redirectUrl.trim().length === 0) return null
    const target = (candidate as { target?: unknown }).target
    return {
      type: 'redirect',
      redirectUrl,
      target: target === 'top' ? 'top' : 'self',
    }
  }
  if (type !== 'embedded') return null
  if (typeof (candidate as { rendererKey?: unknown }).rendererKey !== 'string') return null
  const payload = (candidate as { payload?: unknown }).payload
  const settings = (candidate as { settings?: unknown }).settings
  return {
    type: 'embedded',
    rendererKey: (candidate as { rendererKey: string }).rendererKey,
    payload: payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : undefined,
    settings: settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings as Record<string, unknown>
      : undefined,
  }
}

async function buildSubmitResponse(
  req: Request,
  em: EntityManager,
  link: CheckoutLink,
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
  const requestUrl = new URL(req.url)
  const clientSession = gatewayTransaction
    ? readClientSession(gatewayTransaction.gatewayMetadata)
    : null
  const paymentSession = (clientSession && gatewayTransaction)
    ? {
        ...clientSession,
        ...(clientSession.type === 'embedded'
          ? {
              payload: {
                ...(clientSession.payload ?? {}),
                returnUrl: `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/success/${encodeURIComponent(transaction.id)}`,
                cancelUrl: `${requestUrl.origin}/pay/${encodeURIComponent(link.slug)}/cancel/${encodeURIComponent(transaction.id)}`,
              },
            }
          : {}),
        providerKey: providerKey ?? gatewayTransaction.providerKey ?? null,
        gatewayTransactionId: gatewayTransaction.id,
      }
    : null
  return {
    transactionId: transaction.id,
    redirectUrl: gatewayTransaction?.redirectUrl ?? null,
    paymentSession,
  }
}

export const metadata = {
  path: '/checkout/pay/[slug]/submit',
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> | { slug: string } }) {
  try {
    const container = await createRequestContainer()
    try {
      const rateLimiter = container.resolve('rateLimiterService') as RateLimiterService
      const ip = getClientIp(req, 1) ?? 'unknown'
      const rateLimitResponse = await checkRateLimit(rateLimiter, checkoutSubmitRateLimitConfig, `checkout-submit:${ip}`, 'Too many payment attempts. Please try again later.')
      if (rateLimitResponse) return rateLimitResponse
    } catch {
      // Rate limiting is fail-open
    }
    const resolvedParams = await params

    const origin = req.headers.get('origin')
    const referer = req.headers.get('referer')
    if (origin || referer) {
      const allowedOrigins = buildAllowedOrigins(req)
      const submittedOrigin = origin ?? (referer ? new URL(referer).origin : null)
      if (submittedOrigin && !allowedOrigins.some((allowedOrigin) => isAllowedRequestOrigin(submittedOrigin, allowedOrigin))) {
        return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
      }
    }

    const idempotencyKey = req.headers.get('Idempotency-Key')?.trim()
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'Idempotency-Key header is required' }, { status: 400 })
    }
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return NextResponse.json({ error: 'Idempotency-Key must be between 16 and 128 characters' }, { status: 400 })
    }

    const body = publicSubmitSchema.parse(await req.json().catch(() => ({})))
    const em = container.resolve('em')
    const commandBus = container.resolve('commandBus') as CommandBus
    const paymentGatewayService = container.resolve('paymentGatewayService') as PaymentGatewayService
    const link = await findOneWithDecryption(em, CheckoutLink, {
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
      requireCheckoutPasswordSession(req, link.slug, {
        linkId: link.id,
        sessionVersion: link.passwordHash,
      })
    }
    if (!link.gatewayProviderKey) {
      throw new CrudHttpError(422, { error: 'A payment gateway must be configured before this link can be used' })
    }
    const legalDocuments = link.legalDocuments && typeof link.legalDocuments === 'object'
      ? link.legalDocuments as Partial<Record<'terms' | 'privacyPolicy', CheckoutLegalDocumentRequirement>>
      : {}
    const legalConsentErrors: Record<string, string> = {}
    for (const key of ['terms', 'privacyPolicy'] as const) {
      const document = legalDocuments[key]
      if (document?.required === true && body.acceptedLegalConsents?.[key] !== true) {
        legalConsentErrors[`acceptedLegalConsents.${key}`] = 'checkout.payPage.validation.documentRequired'
      }
    }
    if (Object.keys(legalConsentErrors).length > 0) {
      throw new CrudHttpError(422, {
        error: 'checkout.payPage.validation.fixErrors',
        fieldErrors: legalConsentErrors,
      })
    }
    const collectedCustomerData = link.collectCustomerDetails === false ? {} : body.customerData
    const customerFields = Array.isArray(link.customerFieldsSchema)
      ? link.customerFieldsSchema as CheckoutCustomerFieldRequirement[]
      : []
    if (link.collectCustomerDetails !== false) {
      const customerFieldErrors = validateCheckoutCustomerData(customerFields, collectedCustomerData)
      if (Object.keys(customerFieldErrors).length > 0) {
        throw new CrudHttpError(422, {
          error: 'checkout.payPage.validation.fixErrors',
          fieldErrors: customerFieldErrors,
        })
      }
    }
    const resolvedAmount = resolveSubmittedAmount(link, body)
    validateDescriptorCurrencies(link.gatewayProviderKey, [resolvedAmount.currencyCode])
    const existingTransaction = await findOneWithDecryption(em, CheckoutTransaction, {
      linkId: link.id,
      idempotencyKey,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
    if (existingTransaction?.gatewayTransactionId) {
      return NextResponse.json(
        await buildSubmitResponse(req, em, link, existingTransaction, link.gatewayProviderKey),
      )
    }

    const transactionInput = {
      linkId: link.id,
      amount: resolvedAmount.amount,
      currencyCode: resolvedAmount.currencyCode,
      idempotencyKey,
      customerData: collectedCustomerData,
      firstName: typeof collectedCustomerData.firstName === 'string' ? collectedCustomerData.firstName : null,
      lastName: typeof collectedCustomerData.lastName === 'string' ? collectedCustomerData.lastName : null,
      email: typeof collectedCustomerData.email === 'string' ? collectedCustomerData.email : null,
      phone: typeof collectedCustomerData.phone === 'string' ? collectedCustomerData.phone : null,
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
        const duplicated = await findOneWithDecryption(em, CheckoutTransaction, {
          linkId: link.id,
          idempotencyKey,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
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
    const transaction = await findOneWithDecryption(em, CheckoutTransaction, {
      id: transactionId,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
    }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
    if (!transaction) {
      throw new CrudHttpError(404, { error: 'Transaction not found' })
    }
    if (!transaction.gatewayTransactionId) {
      const configuredPaymentTypes = Array.isArray(link.gatewaySettings?.paymentTypes)
        ? link.gatewaySettings.paymentTypes.filter(
            (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : []
      const rendererKey = typeof link.gatewaySettings?.rendererKey === 'string' && link.gatewaySettings.rendererKey.trim().length > 0
        ? link.gatewaySettings.rendererKey.trim()
        : undefined
      const rendererSettings = link.gatewaySettings?.rendererSettings
        && typeof link.gatewaySettings.rendererSettings === 'object'
        && !Array.isArray(link.gatewaySettings.rendererSettings)
        ? link.gatewaySettings.rendererSettings as Record<string, unknown>
        : undefined
      const presentationMode = link.gatewaySettings?.presentationMode === 'embedded'
        || link.gatewaySettings?.presentationMode === 'redirect'
        || link.gatewaySettings?.presentationMode === 'auto'
        ? link.gatewaySettings.presentationMode
        : undefined
      try {
        const sessionResult = await paymentGatewayService.createPaymentSession({
          providerKey: link.gatewayProviderKey,
          paymentId: transactionId,
          amount: resolvedAmount.amount,
          currencyCode: resolvedAmount.currencyCode,
          paymentTypes: configuredPaymentTypes.length > 0 ? configuredPaymentTypes : undefined,
          description: link.title ?? link.name,
          successUrl,
          cancelUrl,
          metadata: {
            checkoutLinkId: link.id,
            checkoutSlug: link.slug,
          },
          presentation: rendererKey || rendererSettings || presentationMode
            ? {
                ...(presentationMode ? { mode: presentationMode } : {}),
                ...(rendererKey ? { rendererKey } : {}),
                ...(rendererSettings ? { rendererSettings } : {}),
              }
            : undefined,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        })
        await commandBus.execute('checkout.transaction.updateStatus', {
          input: {
            id: transaction.id,
            status: mapGatewayStatusToCheckoutStatus(sessionResult.transaction.unifiedStatus),
            paymentStatus: sessionResult.transaction.unifiedStatus,
            gatewayTransactionId: sessionResult.transaction.id,
            organizationId: link.organizationId,
            tenantId: link.tenantId,
          },
          ctx,
        })
      } catch (error) {
        await commandBus.execute('checkout.transaction.updateStatus', {
          input: {
            id: transaction.id,
            status: 'failed',
            paymentStatus: transaction.paymentStatus ?? 'failed',
            organizationId: link.organizationId,
            tenantId: link.tenantId,
          },
          ctx,
        }).catch(() => undefined)
        console.error('[checkout] Failed to create payment session', {
          linkId: link.id,
          transactionId: transaction.id,
          providerKey: link.gatewayProviderKey,
          error: error instanceof Error ? error.message : String(error),
        })
        throw new CrudHttpError(502, { error: 'Unable to start the payment session' })
      }
      const refreshedTransaction = await findOneWithDecryption(em, CheckoutTransaction, {
        id: transaction.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      }, undefined, { organizationId: link.organizationId, tenantId: link.tenantId })
      if (!refreshedTransaction) {
        throw new CrudHttpError(404, { error: 'Transaction not found' })
      }
      await emitCheckoutEvent('checkout.transaction.sessionStarted', {
        transactionId: refreshedTransaction.id,
        linkId: refreshedTransaction.linkId,
        templateId: link.templateId ?? null,
        slug: link.slug,
        status: refreshedTransaction.status,
        paymentStatus: refreshedTransaction.paymentStatus ?? null,
        amount: Number(refreshedTransaction.amount),
        currency: refreshedTransaction.currencyCode,
        gatewayProvider: link.gatewayProviderKey,
        gatewayTransactionId: refreshedTransaction.gatewayTransactionId ?? null,
        occurredAt: new Date().toISOString(),
        tenantId: link.tenantId,
        organizationId: link.organizationId,
      }).catch(() => undefined)
      return NextResponse.json(
        await buildSubmitResponse(req, em, link, refreshedTransaction, link.gatewayProviderKey),
        { status: 201 },
      )
    }
    return NextResponse.json(await buildSubmitResponse(req, em, link, transaction, link.gatewayProviderKey), { status: 201 })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
}

export default POST
