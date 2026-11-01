import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, RATE_LIMIT_FALLBACK_KEY, rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { validateSameOriginMutationRequest } from './originGuard'
import { hashAuthToken } from '../../../../auth/lib/tokenHash'
import { SalesOrder, SalesQuote } from '../../../data/entities'
import { quoteAcceptSchema } from '../../../data/validators'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveStatusEntryIdByValue } from '../../../lib/statusHelpers'
import { resolveEffectiveTenantId } from '../../../lib/publicQuoteTenantScope'
import { QuoteAcceptedAdminEmail } from '../../../emails/QuoteAcceptedAdminEmail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import type { CustomerPurchaseApprovalService } from '@open-mercato/core/modules/customer_groups/services/customerPurchaseApprovalService'

const logger = createLogger('sales')

/**
 * `customer_groups` is an optional peer of `sales` — resolved defensively, same soft-DI
 * shape `cart/lib/adminCartScope.ts#tryResolveCustomerPurchaseApprovalService` already uses
 * for the same service. A quote whose `metadata.pendingApproval.required` is `true` (set by
 * checkout's `cart.lock`-time snapshot, D-R5-23) fails closed when the service cannot be
 * resolved — unlike the gate's own "degrade to false" default for computing whether
 * approval is required in the first place, a quote already flagged as requiring approval
 * must never silently convert just because the proof is unavailable.
 */
function tryResolveCustomerPurchaseApprovalService(container: {
  resolve: <T = unknown>(name: string) => T
}): CustomerPurchaseApprovalService | null {
  try {
    return container.resolve<CustomerPurchaseApprovalService>('customerPurchaseApprovalService') ?? null
  } catch {
    return null
  }
}

type ConvertToOrderResult = {
  result?: { orderId?: string } | null
  orderId?: string
}

export const metadata = {
  POST: { requireAuth: false },
}

const quoteAcceptRateLimitConfig = readEndpointRateLimitConfig('SALES_QUOTES_ACCEPT', {
  points: 10,
  duration: 60,
  blockDuration: 300,
  keyPrefix: 'sales_quote_accept',
})

export async function POST(req: Request) {
  try {
    const { translate } = await resolveTranslations()
    const sameOriginViolation = validateSameOriginMutationRequest(req)
    if (sameOriginViolation) {
      return NextResponse.json(
        { error: translate('sales.quotes.accept.forbidden', 'Cross-site quote acceptance is not allowed.') },
        { status: 403 },
      )
    }

    const rateLimiterService = getCachedRateLimiterService()
    const clientIp = rateLimiterService ? getClientIp(req, rateLimiterService.trustProxyDepth) : null
    if (rateLimiterService) {
      const rateLimitResponse = await checkRateLimit(
        rateLimiterService,
        quoteAcceptRateLimitConfig,
        clientIp ?? RATE_LIMIT_FALLBACK_KEY,
        translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
      )
      if (rateLimitResponse) return rateLimitResponse
    }

    const { token } = quoteAcceptSchema.parse(await req.json().catch(() => ({})))
    const auth = await getAuthFromRequest(req)
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    const hashedToken = hashAuthToken(token)
    const effectiveTenantId = resolveEffectiveTenantId(auth)
    // A session whose tenant cannot be resolved must not fall through to an unscoped lookup.
    // Anonymous callers (no auth) and tenant-less API keys stay unscoped by design.
    if (auth && effectiveTenantId === null && auth.isApiKey !== true) {
      throw new CrudHttpError(404, { error: translate('sales.quotes.accept.notFound', 'Quote not found.') })
    }
    const tenantScope = effectiveTenantId ? { tenantId: effectiveTenantId } : undefined

    const commandBus = container.resolve('commandBus') as CommandBus

    // Lock the quote, flip it to confirmed, and convert it to an order inside a
    // single transaction. The conversion command reuses this transaction (and its
    // PESSIMISTIC_WRITE lock) via ctx.transactionalEm, so the status flip and the
    // order creation are atomic: if conversion fails the whole transaction rolls
    // back, leaving the quote in its prior 'sent' state with no partial order and
    // no need for an out-of-band compensating write.
    const { quote, orderId } = await em.transactional(async (trx) => {
      const findQuoteByToken = (acceptanceToken: string) =>
        findOneWithDecryption(
          trx,
          SalesQuote,
          {
            acceptanceToken,
            ...(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
            deletedAt: null,
          },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          tenantScope,
        )
      const quote = await findQuoteByToken(hashedToken)
      if (!quote) {
        throw notFound(translate('sales.quotes.accept.notFound', 'Quote not found.'))
      }

      const now = new Date()
      if (quote.validUntil && quote.validUntil.getTime() < now.getTime()) {
        throw new CrudHttpError(400, { error: translate('sales.quotes.accept.expired', 'This quote has expired.') })
      }

      if ((quote.status ?? null) !== 'sent') {
        throw new CrudHttpError(400, {
          error: translate('sales.quotes.accept.invalidStatus', 'This quote cannot be accepted in its current status.'),
        })
      }

      // D-R5-23: checkout's `cart.lock` skips the over-threshold approval gate (K2) for
      // `purpose: 'quote'` carts and snapshots its own verdict onto `quote.metadata
      // .pendingApproval` at quote-creation time (`checkout/commands/submit.ts`). Re-running
      // that gate HERE — before the quote is allowed to convert to an order — is the
      // "approval returns at quote acceptance" half of D-R5-23: without it, a buyer holding
      // nothing but the emailed acceptance token could self-accept an over-threshold quote
      // into a finalized order with no approval check at any point.
      const pendingApproval = (quote.metadata as { pendingApproval?: { required?: boolean; approvalId?: string | null } } | null)
        ?.pendingApproval
      if (pendingApproval?.required) {
        const approvalService = tryResolveCustomerPurchaseApprovalService(container)
        const approval = pendingApproval.approvalId && approvalService
          ? await approvalService.getApproval({
              scope: { tenantId: quote.tenantId, organizationId: quote.organizationId },
              approvalId: pendingApproval.approvalId,
            })
          : null
        const qualifies = !!approval
          && approval.status === 'approved'
          && approval.currencyCode === quote.currencyCode
          && Number(approval.amountGross) >= Number(quote.grandTotalGrossAmount)
        if (!qualifies) {
          throw new CrudHttpError(409, {
            error: translate('sales.quotes.accept.requiresApproval', 'This quote requires approval before it can be accepted.'),
            code: 'quote_requires_approval',
          })
        }
      }

      quote.status = 'confirmed'
      quote.statusEntryId = await resolveStatusEntryIdByValue(trx, {
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        value: 'confirmed',
      })
      quote.updatedAt = now
      trx.persist(quote)
      await trx.flush()

      const ctx: CommandRuntimeContext = {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: quote.organizationId,
        organizationIds: [quote.organizationId],
        request: req,
        transactionalEm: trx,
      }

      const result = (await commandBus.execute('sales.quotes.convert_to_order', { input: { quoteId: quote.id }, ctx })) as ConvertToOrderResult | null
      const orderId = result?.result?.orderId ?? result?.orderId ?? quote.id

      return { quote, orderId }
    })

    const order = await findOneWithDecryption(em, SalesOrder, { id: orderId, deletedAt: null }, {}, tenantScope)
    const orderNumber = order?.orderNumber ?? orderId

    // Admin notification should not block acceptance.
    const adminEmail = process.env.ADMIN_EMAIL || ''
    if (adminEmail) {
      try {
        const appUrl = process.env.APP_URL || ''
        const orderUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/backend/sales/orders/${orderId}` : `/backend/sales/orders/${orderId}`

        const copy = {
          preview: translate('sales.quotes.accept.adminEmail.preview', 'Quote {quoteNumber} accepted', { quoteNumber: quote.quoteNumber }),
          heading: translate('sales.quotes.accept.adminEmail.heading', 'Quote {quoteNumber} accepted', { quoteNumber: quote.quoteNumber }),
          body: translate('sales.quotes.accept.adminEmail.body', 'The customer accepted quote {quoteNumber}. An order has been created: {orderNumber}.', {
            quoteNumber: quote.quoteNumber,
            orderNumber,
          }),
          cta: translate('sales.quotes.accept.adminEmail.cta', 'View order'),
          footer: translate('sales.quotes.accept.adminEmail.footer', 'Open Mercato'),
        }

        await sendEmail({
          to: adminEmail,
          subject: translate('sales.quotes.accept.adminSubject', 'Quote {quoteNumber} accepted → Order {orderNumber}', {
            quoteNumber: quote.quoteNumber,
            orderNumber,
          }),
          react: QuoteAcceptedAdminEmail({ orderUrl, copy }),
          tenantId: quote.tenantId,
          organizationId: quote.organizationId,
        })
      } catch (err) {
        logger.error('sales.quotes.accept.adminEmail failed', { err })
      }
    }

    return NextResponse.json({ orderId, orderNumber })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.quotes.accept failed', { err })
    return NextResponse.json({ error: translate('sales.quotes.accept.failed', 'Failed to accept quote.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Accept a quote (public)',
  methods: {
    POST: {
      summary: 'Accept quote and convert to order',
      requestBody: {
        contentType: 'application/json',
        schema: quoteAcceptSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Quote accepted and order created',
          schema: z.object({ orderId: z.string().uuid(), orderNumber: z.string() }),
        },
        { status: 400, description: 'Invalid or expired quote', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Cross-site request rejected', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Quote requires approval before it can be accepted', schema: z.object({ error: z.string(), code: z.literal('quote_requires_approval') }) },
        { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
      ],
    },
  },
}
