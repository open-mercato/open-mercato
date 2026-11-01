import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findAndCountWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../../../../../data/entities'
import { customerCreditLedgerListQuerySchema } from '../../../../../data/validators'
import { organizationIdsFromScope } from '../../../../../lib/customerScope'

const logger = createLogger('customer_groups')

// Release 5 Phase 3 (Step 1.11, §9): read-only ledger of one credit account, newest
// first, `pageSize ≤ 100`. The ledger is append-only (§5.5: no `updated_at`, no
// `deleted_at`), so there is no write method and no optimistic lock here. The account is
// organization-scoped: it is looked up within the caller's organization scope first —
// the same scope `makeCrudRoute` applies to the sibling list — and an account outside
// it answers 404, the same body as an unknown id, so a foreign id is never confirmed.
// `note` is encrypted (`encryption.ts`, G22) and decrypted through
// `findAndCountWithDecryption` with the account's own tenant and organization.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customer_groups.credit.view'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function serializeLedgerEntry(entry: CustomerCreditLedgerEntry) {
  return {
    id: entry.id,
    creditAccountId: entry.creditAccountId,
    entryType: entry.entryType,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId ?? null,
    relatedEntryId: entry.relatedEntryId ?? null,
    linkedOrderId: entry.linkedOrderId ?? null,
    createdByActorType: entry.createdByActorType,
    createdByUserId: entry.createdByUserId ?? null,
    note: entry.note ?? null,
    createdAt: toIsoString(entry.createdAt),
  }
}

export async function GET(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  const accountNotFound = () =>
    notFound(translate('customer_groups.errors.creditAccountNotFound', 'Credit account not found.'))
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') })
    }

    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) throw accountNotFound()

    const url = new URL(req.url)
    const query = customerCreditLedgerListQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })
    if (!query.success) {
      throw new CrudHttpError(400, { error: translate('customer_groups.errors.invalid_input', 'Invalid input') })
    }
    const { page, pageSize } = query.data

    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()

    // Same fallback as `makeCrudRoute` and `explain-terms`: an unresolvable scope
    // narrows to the caller's own organization; `null` is an unrestricted caller.
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromScope(scope, scope?.selectedId ?? auth.orgId ?? null)
    if (Array.isArray(organizationIds) && organizationIds.length === 0) throw accountNotFound()

    const account = await findOneWithDecryption(
      em,
      CustomerCreditAccount,
      {
        id: params.data.id,
        tenantId,
        deletedAt: null,
        ...(Array.isArray(organizationIds) ? { organizationId: { $in: organizationIds } } : {}),
      },
      undefined,
      { tenantId },
    )
    if (!account) throw accountNotFound()

    const [entries, total] = await findAndCountWithDecryption(
      em,
      CustomerCreditLedgerEntry,
      { creditAccountId: account.id, tenantId, organizationId: account.organizationId },
      { orderBy: { createdAt: 'desc', id: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
      { tenantId, organizationId: account.organizationId },
    )

    return NextResponse.json({
      items: entries.map(serializeLedgerEntry),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customer_groups.credit.ledger failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.credit_ledger_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.creditLedgerLoadFailed', 'Failed to load the credit ledger.') },
      { status: 500 },
    )
  }
}

const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  creditAccountId: z.string().uuid(),
  entryType: z.enum(['reserve', 'release', 'settle', 'adjust']),
  amount: z.string(),
  balanceAfter: z.string(),
  sourceType: z.enum(['checkout', 'order', 'invoice', 'payment', 'manual']),
  sourceId: z.string().uuid().nullable(),
  relatedEntryId: z.string().uuid().nullable(),
  linkedOrderId: z.string().uuid().nullable(),
  createdByActorType: z.enum(['staff_user', 'system']),
  createdByUserId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().nullable(),
})

const ledgerResponseSchema = z.object({
  items: z.array(ledgerEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const ledgerErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'List a credit account ledger',
  methods: {
    GET: {
      summary: 'List a credit account ledger',
      description:
        'Returns the append-only ledger of one credit account, newest first, with the free-text note decrypted. Scoped to the caller\'s tenant and organizations; an account outside them answers 404.',
      query: customerCreditLedgerListQuerySchema,
      responses: [{ status: 200, description: 'A page of ledger entries', schema: ledgerResponseSchema }],
      errors: [
        { status: 400, description: 'Tenant context is required or the query is invalid', schema: ledgerErrorSchema },
        { status: 401, description: 'Unauthorized', schema: ledgerErrorSchema },
        { status: 404, description: 'Credit account not found in the caller scope', schema: ledgerErrorSchema },
        { status: 500, description: 'Unexpected failure', schema: ledgerErrorSchema },
      ],
    },
  },
}
