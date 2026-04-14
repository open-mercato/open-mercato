import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations, detectLocale } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import crypto from 'node:crypto'
import { withScopedPayload } from '../../utils'
import { hashAuthToken } from '../../../../auth/lib/tokenHash'
import { SalesQuote } from '../../../data/entities'
import { quoteSendSchema } from '../../../data/validators'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveStatusEntryIdByValue } from '../../../lib/statusHelpers'
import { QuoteSentEmail } from '../../../emails/QuoteSentEmail'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function runGuards(
  ctx: CommandRuntimeContext,
  input: MutationGuardInput,
): Promise<{
  ok: boolean
  errorBody?: Record<string, unknown>
  errorStatus?: number
  afterSuccessCallbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>
}> {
  const legacyGuard = bridgeLegacyGuard(ctx.container)
  if (!legacyGuard) {
    return { ok: true, afterSuccessCallbacks: [] }
  }

  return runMutationGuards([legacyGuard], input, {
    userFeatures: resolveUserFeatures(ctx.auth),
  })
}

async function runGuardAfterSuccessCallbacks(
  callbacks: Array<{ guard: MutationGuard; metadata: Record<string, unknown> | null }>,
  input: {
    tenantId: string
    organizationId: string | null
    userId: string
    resourceKind: string
    resourceId: string
    operation: 'create' | 'update' | 'delete'
    requestMethod: string
    requestHeaders: Headers
  },
): Promise<void> {
  for (const callback of callbacks) {
    if (!callback.guard.afterSuccess) continue
    await callback.guard.afterSuccess({
      ...input,
      metadata: callback.metadata ?? null,
    })
  }
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx }
}

function resolveQuoteEmail(quote: SalesQuote): string | null {
  const snapshot = quote.customerSnapshot && typeof quote.customerSnapshot === 'object' ? (quote.customerSnapshot as Record<string, unknown>) : null
  const metadata = quote.metadata && typeof quote.metadata === 'object' ? (quote.metadata as Record<string, unknown>) : null
  const contact = snapshot?.contact as Record<string, unknown> | undefined
  const customer = snapshot?.customer as Record<string, unknown> | undefined
  const candidate =
    (typeof contact?.email === 'string' && contact.email.trim()) ||
    (typeof customer?.primaryEmail === 'string' && customer.primaryEmail.trim()) ||
    (typeof metadata?.customerEmail === 'string' && metadata.customerEmail.trim()) ||
    null
  if (!candidate) return null
  const parsed = z.string().email().safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export async function POST(req: Request) {
  try {
    const { ctx } = await resolveRequestContext(req)
    const { translate } = await resolveTranslations()
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload ?? {}, ctx, translate)
    const input = quoteSendSchema.parse(scoped)
    const guardResult = await runGuards(ctx, {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      userId: ctx.auth?.sub ?? '',
      resourceKind: 'sales.quote',
      resourceId: input.quoteId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, { status: guardResult.errorStatus ?? 422 })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const quote = await em.findOne(SalesQuote, { id: input.quoteId, deletedAt: null })
    if (!quote) {
      throw new CrudHttpError(404, { error: translate('sales.documents.detail.error', 'Document not found or inaccessible.') })
    }
    if (quote.tenantId !== ctx.auth?.tenantId || quote.organizationId !== ctx.selectedOrganizationId) {
      throw new CrudHttpError(403, { error: translate('sales.documents.errors.forbidden', 'Forbidden') })
    }

    if ((quote.status ?? null) === 'canceled') {
      throw new CrudHttpError(400, { error: translate('sales.quotes.send.canceled', 'Canceled quotes cannot be sent.') })
    }

    const email = resolveQuoteEmail(quote)
    if (!email) {
      throw new CrudHttpError(400, { error: translate('sales.quotes.send.missingEmail', 'Customer email is required to send a quote.') })
    }

    const now = new Date()
    const validUntil = new Date(now)
    validUntil.setUTCDate(validUntil.getUTCDate() + input.validForDays)

    const rawAcceptanceToken = crypto.randomUUID()
    quote.validUntil = validUntil
    quote.acceptanceToken = hashAuthToken(rawAcceptanceToken)
    quote.sentAt = now
    quote.status = 'sent'
    quote.statusEntryId = await resolveStatusEntryIdByValue(em, {
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      value: 'sent',
    })
    quote.updatedAt = now
    em.persist(quote)
    await em.flush()

    const appUrl = process.env.APP_URL || ''
    const url = appUrl ? `${appUrl.replace(/\/$/, '')}/quote/${rawAcceptanceToken}` : `/quote/${rawAcceptanceToken}`

    const locale = await detectLocale()
    const validUntilFormatted = validUntil.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const copy = {
      preview: translate('sales.quotes.email.preview', 'Quote {quoteNumber} is ready for review', { quoteNumber: quote.quoteNumber }),
      heading: translate('sales.quotes.email.heading', 'Quote {quoteNumber}', { quoteNumber: quote.quoteNumber }),
      total: translate('sales.quotes.email.total', 'Total: {amount} {currency}', {
        amount: quote.grandTotalGrossAmount ?? quote.grandTotalNetAmount ?? '0',
        currency: quote.currencyCode,
      }),
      validUntil: translate('sales.quotes.email.validUntil', 'Valid until: {date}', { date: validUntilFormatted }),
      cta: translate('sales.quotes.email.cta', 'View quote'),
      footer: translate('sales.quotes.email.footer', 'Open Mercato'),
    }

    await sendEmail({
      to: email,
      subject: translate('sales.quotes.email.subject', 'Quote {quoteNumber}', { quoteNumber: quote.quoteNumber }),
      react: QuoteSentEmail({ url, copy }),
    })

    if (guardResult.afterSuccessCallbacks.length) {
      await runGuardAfterSuccessCallbacks(guardResult.afterSuccessCallbacks, {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
        resourceKind: 'sales.quote',
        resourceId: input.quoteId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.quotes.send failed', err)
    return NextResponse.json(
      { error: translate('sales.quotes.send.failed', 'Failed to send quote.') },
      { status: 400 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Send quote to customer',
  methods: {
    POST: {
      summary: 'Send quote',
      requestBody: {
        contentType: 'application/json',
        schema: quoteSendSchema,
      },
      responses: [
        { status: 200, description: 'Email queued', schema: z.object({ ok: z.literal(true) }) },
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Conflict detected', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 423, description: 'Record locked', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
