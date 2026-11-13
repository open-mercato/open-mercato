import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations, detectLocale } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { EntityManager } from '@mikro-orm/postgresql'
import crypto from 'node:crypto'
import { withScopedPayload } from '../../utils'
import { hashAuthToken } from '../../../../auth/lib/tokenHash'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SalesQuote } from '../../../data/entities'
import { quoteSendSchema } from '../../../data/validators'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveStatusEntryIdByValue } from '../../../lib/statusHelpers'
import { QuoteSentEmail, type QuoteSentEmailCopy } from '../../../emails/QuoteSentEmail'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('sales')

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage'] },
}

type RequestContext = {
  ctx: CommandRuntimeContext
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
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

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}

/** Lower-cased, de-duplicated CC list without the primary recipient (#8460). */
function resolveCcRecipients(requested: string[], primary: string): string[] {
  const primaryKey = primary.trim().toLowerCase()
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of requested) {
    const key = entry.trim().toLowerCase()
    if (!key || key === primaryKey || seen.has(key)) continue
    seen.add(key)
    result.push(entry.trim())
  }
  return result
}

/**
 * Mails each CC recipient their own copy of the quote details. The acceptance link is a
 * bearer capability reserved for the main recipient, so these copies never carry it, and
 * a copy that fails must not turn a delivered quote into a reported failure.
 */
async function sendCcCopies(
  quote: SalesQuote,
  recipients: string[],
  subject: string,
  copy: QuoteSentEmailCopy,
): Promise<void> {
  for (const recipient of recipients) {
    try {
      await sendEmail({
        to: recipient,
        subject,
        react: QuoteSentEmail({ copy }),
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
      })
    } catch (err) {
      logger.error('sales.quotes.send CC copy failed', { err, quoteId: quote.id })
      try {
        getTelemetryRuntime()?.reportError(err, {
          module: 'sales',
          code: 'sales.quote_cc_copy_failed',
          attributes: { quoteId: quote.id },
        })
      } catch (reportingErr) {
        logger.warn('sales.quotes.send CC copy failure could not be reported', { err: reportingErr, quoteId: quote.id })
      }
    }
  }
}

/**
 * The quotes list is served from the CRUD GET cache, so a custom route flushes it itself
 * or the list keeps reporting the quote as unsent until the entry expires. The send state
 * is already committed when this runs: a cache backend that rejects must not stop the
 * quote from being mailed, so the failure is reported and the stale entry is left to expire.
 */
async function flushQuoteListCache(
  container: Parameters<typeof invalidateCrudCache>[0],
  quote: SalesQuote,
): Promise<void> {
  try {
    await invalidateCrudCache(
      container,
      'sales.quote',
      { id: quote.id, tenantId: quote.tenantId, organizationId: quote.organizationId },
      quote.tenantId ?? null,
      'updated',
    )
  } catch (err) {
    logger.error('sales.quotes.send cache invalidation failed', { err, quoteId: quote.id })
    try {
      getTelemetryRuntime()?.reportError(err, {
        module: 'sales',
        code: 'sales.quote_send_cache_invalidation_failed',
        attributes: { quoteId: quote.id },
      })
    } catch (reportingErr) {
      logger.warn('sales.quotes.send cache invalidation failure could not be reported', { err: reportingErr, quoteId: quote.id })
    }
  }
}

function resolveQuoteEmail(quote: SalesQuote): string | null {
  const snapshot = normalizeRecord(quote.customerSnapshot)
  const metadata = normalizeRecord(quote.metadata)
  const contact = snapshot?.contact as Record<string, unknown> | undefined
  const customer = snapshot?.customer as Record<string, unknown> | undefined
  // The document's own "Send to" address is the user's explicit choice (#8459); the
  // snapshot contact and the customer's primary e-mail are fallbacks for documents
  // saved without one.
  const candidate =
    (typeof metadata?.customerEmail === 'string' && metadata.customerEmail.trim()) ||
    (typeof contact?.email === 'string' && contact.email.trim()) ||
    (typeof customer?.primaryEmail === 'string' && customer.primaryEmail.trim()) ||
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
    let input = quoteSendSchema.parse(scoped)
    const guardResult = await runRouteMutationGuards({
      container: ctx.container,
      req,
      auth: {
        tenantId: ctx.auth?.tenantId ?? '',
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        userId: ctx.auth?.sub ?? '',
      },
      input: {
        resourceKind: 'sales.quote',
        resourceId: input.quoteId,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) {
      return guardResult.response
    }
    if (guardResult.modifiedPayload) {
      input = quoteSendSchema.parse({ ...input, ...guardResult.modifiedPayload })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantScope = ctx.auth?.tenantId
      ? { tenantId: ctx.auth.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null }
      : undefined
    const quote = await findOneWithDecryption(em, SalesQuote, { id: input.quoteId, deletedAt: null }, {}, tenantScope)
    if (!quote) {
      throw notFound(translate('sales.documents.detail.error', 'Document not found or inaccessible.'))
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
    const cc = resolveCcRecipients(input.cc, email)

    const now = new Date()
    const validUntil = new Date(now)
    validUntil.setUTCDate(validUntil.getUTCDate() + input.validForDays)

    const rawAcceptanceToken = crypto.randomUUID()

    // Persist the send state (status/token/sentAt) atomically and commit it
    // BEFORE the email goes out, so a customer never receives a link whose
    // acceptance token was not durably stored.
    await em.transactional(async (tx) => {
      quote.validUntil = validUntil
      quote.acceptanceToken = hashAuthToken(rawAcceptanceToken)
      quote.sentAt = now
      quote.status = 'sent'
      quote.statusEntryId = await resolveStatusEntryIdByValue(tx, {
        tenantId: quote.tenantId,
        organizationId: quote.organizationId,
        value: 'sent',
      })
      quote.metadata = { ...(normalizeRecord(quote.metadata) ?? {}), recipients: { cc } }
      quote.updatedAt = now
      tx.persist(quote)
    })

    await flushQuoteListCache(ctx.container, quote)

    const appUrl = process.env.APP_URL || ''
    const url = appUrl ? `${appUrl.replace(/\/$/, '')}/quote/${rawAcceptanceToken}` : `/quote/${rawAcceptanceToken}`

    const locale = await detectLocale()
    const validUntilFormatted = validUntil.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const copy: QuoteSentEmailCopy = {
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

    const subject = translate('sales.quotes.email.subject', 'Quote {quoteNumber}', { quoteNumber: quote.quoteNumber })

    // Side effect after commit: an email failure must not roll back the send state.
    await sendEmail({
      to: email,
      subject,
      react: QuoteSentEmail({ url, copy }),
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
    })

    const ccNotice = translate(
      'sales.quotes.email.ccNotice',
      'You are receiving this copy for your information. The main recipient can review and accept the quote.',
    )
    await sendCcCopies(quote, cc, subject, { ...copy, preview: ccNotice, notice: ccNotice })

    await guardResult.runAfterSuccess()

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.quotes.send failed', { err })
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
