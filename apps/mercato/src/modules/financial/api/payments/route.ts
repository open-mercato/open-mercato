import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GlJournalEntry, GlPaymentMethod } from '../../data/entities'
import { PAYMENT_DIRECTIONS, recordPaymentSchema } from '../../data/validators'
import { toMinorUnits } from '../../lib/glService'
import { isStatementDate } from '../../lib/statements'
import { FINANCIAL_ENTRY_ENTITY_ID } from '../../commands/ledger'
import { PAYMENT_RECORD_COMMAND_ID, type RecordPaymentResult } from '../../commands/moneyActions'
import { createPagedListResponseSchema } from '../openapi'
import { runLedgerAction } from '../ledgerAction'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/payments',
  GET: { requireAuth: true, requireFeatures: ['financial.payments.view'] },
  POST: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
}

const paymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  direction: z.enum(PAYMENT_DIRECTIONS).optional(),
  paymentMethodId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

const paymentRowSchema = z.object({
  id: z.string().uuid(),
  entryNumber: z.string(),
  entryDate: z.string(),
  postingDate: z.string(),
  description: z.string(),
  reference: z.string().nullable(),
  currencyCode: z.string(),
  direction: z.enum(PAYMENT_DIRECTIONS),
  amount: z.string(),
  paymentMethodId: z.string().uuid(),
  paymentMethodCode: z.string(),
  paymentMethodName: z.string(),
  updatedAt: z.string(),
})

type PaymentRow = z.infer<typeof paymentRowSchema>

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/**
 * The payment register, read from the posted entries money moved through.
 *
 * A payment has no row of its own — it is the journal entry `payments.record`
 * posted — so a row is identified by the entry having a line on a payment
 * method's GL account, and the direction is read from which side of that line
 * the money account sits on. The method register is loaded including archived
 * methods: a method archived last week still names the payments it already took.
 */
export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('errors.organization_required', 'Organization context is required'),
      })
    }
    const query = paymentsQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    for (const value of [query.from, query.to]) {
      if (value !== undefined && !isStatementDate(value)) {
        throw new CrudHttpError(400, { error: translate('errors.invalid_input', 'Invalid input') })
      }
    }
    const em = (container.resolve('em') as EntityManager).fork()
    const methods = await em.find(
      GlPaymentMethod,
      { tenantId: auth.tenantId, organizationId },
      { orderBy: { sortOrder: 'asc', code: 'asc' } },
    )
    const selectedMethod = query.paymentMethodId
      ? methods.find((method) => method.id === query.paymentMethodId) ?? null
      : null
    const emptyPage = NextResponse.json({ items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 0 })
    // A method this organization does not have filters everything out; falling
    // back to every method's account would answer a narrow question with the
    // whole register.
    if (query.paymentMethodId && !selectedMethod) return emptyPage
    const moneyAccountIds = [
      ...new Set(selectedMethod ? [selectedMethod.accountId] : methods.map((method) => method.accountId)),
    ]
    if (moneyAccountIds.length === 0) return emptyPage
    const methodByAccountId = new Map<string, GlPaymentMethod>()
    for (const method of methods) {
      if (!methodByAccountId.has(method.accountId)) methodByAccountId.set(method.accountId, method)
    }
    const postingDate = {
      ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { $lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
    }
    const [entries, total] = await em.findAndCount(
      GlJournalEntry,
      {
        tenantId: auth.tenantId,
        organizationId,
        status: 'posted',
        entryType: 'standard',
        ...(query.from || query.to ? { postingDate } : {}),
        lines: {
          account: { id: { $in: moneyAccountIds } },
          // The column is numeric(19,4); the operand stays a decimal string so
          // nothing here goes through a float.
          ...(query.direction === 'in' ? { debitAmount: { $gt: '0' } } : {}),
          ...(query.direction === 'out' ? { creditAmount: { $gt: '0' } } : {}),
        },
      },
      {
        populate: ['lines', 'lines.account'],
        orderBy: { postingDate: 'desc', entryNumber: 'desc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
    )
    const items: PaymentRow[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const moneyLine = [...entry.lines.getItems()]
        .sort((left, right) => left.lineNumber - right.lineNumber)
        .find((line) => methodByAccountId.has(line.account.id))
      if (!moneyLine) continue
      const method = methodByAccountId.get(moneyLine.account.id)
      if (!method) continue
      const isReceipt = toMinorUnits(moneyLine.debitAmount) > 0n
      items.push({
        id: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: isoDay(entry.entryDate),
        postingDate: isoDay(entry.postingDate),
        description: entry.description,
        reference: entry.reference ?? null,
        currencyCode: entry.currencyCode,
        direction: isReceipt ? 'in' : 'out',
        amount: isReceipt ? moneyLine.debitAmount : moneyLine.creditAmount,
        paymentMethodId: method.id,
        paymentMethodCode: method.code,
        paymentMethodName: method.name,
        updatedAt: entry.updatedAt.toISOString(),
      })
    }
    return NextResponse.json({
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    }
    logger.error('financial.payments.GET failed', { err })
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to read the payments') },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof recordPaymentSchema>, RecordPaymentResult>({
    req,
    schema: recordPaymentSchema,
    commandId: PAYMENT_RECORD_COMMAND_ID,
    resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
    // The entry does not exist before the command runs, so there is no resource
    // to name for the guards (the registry reads an absent id as `''`).
    resolveResourceId: () => '',
    fallbackError: 'Unable to record the payment',
  })
}

const listDoc: OpenApiMethodDoc = {
  summary: 'The payment register',
  description:
    'Posted entries money moved through, newest first. A payment is identified by a line on a payment method’s GL account; `direction` is read from which side of that line the money account sits on. Filters: `direction`, `paymentMethodId`, `from` and `to` (posting date, inclusive).',
  responses: [
    {
      status: 200,
      description: 'A page of payments',
      schema: createPagedListResponseSchema(paymentRowSchema),
    },
  ],
  errors: [
    { status: 400, description: 'Invalid query or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
  ],
}

const recordDoc: OpenApiMethodDoc = {
  summary: 'Record a payment',
  description:
    'Posts the two lines a payment is: a receipt debits where the money landed and credits what it came from, a payment does the reverse. Refused when the method needs a reference it was not given, when the payment date has no period, when that period is closed, or when the money account is not an asset account. Carries the optimistic-lock header, so a stale updatedAt returns 409.',
  requestBody: { contentType: 'application/json', schema: recordPaymentSchema },
  responses: [
    {
      status: 200,
      description: 'Payment recorded and posted',
      schema: z.object({
        entryId: z.string().uuid(),
        entryNumber: z.string(),
        postingDate: z.string(),
        direction: z.enum(PAYMENT_DIRECTIONS),
        amount: z.string(),
        methodCode: z.string(),
        updatedAt: z.string(),
      }),
    },
  ],
  errors: [
    { status: 400, description: 'Invalid input or no period for the payment date' },
    { status: 401, description: 'Unauthorized' },
    { status: 404, description: 'Payment method or cash account not found' },
    { status: 409, description: 'The period is closed' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Payments',
  methods: { GET: listDoc, POST: recordDoc },
}
