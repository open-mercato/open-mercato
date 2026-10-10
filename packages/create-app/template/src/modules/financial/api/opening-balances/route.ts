import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { GlJournalEntry } from '../../data/entities'
import { postOpeningBalancesSchema } from '../../data/validators'
import { openingBalanceTotal } from '../../lib/financeService'
import { FINANCIAL_ENTRY_ENTITY_ID } from '../../commands/ledger'
import { OPENING_BALANCES_POST_COMMAND_ID, type PostOpeningBalancesResult } from '../../commands/moneyActions'
import { runLedgerAction } from '../ledgerAction'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/opening-balances',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.post'] },
}

const openingBalanceLineResponseSchema = z.object({
  accountId: z.string().uuid(),
  accountCode: z.string(),
  accountName: z.string(),
  debitAmount: z.string(),
  creditAmount: z.string(),
})

const openingBalancesResponseSchema = z.object({
  posted: z.boolean(),
  entry: z
    .object({
      id: z.string().uuid(),
      entryNumber: z.string(),
      postingDate: z.string(),
      updatedAt: z.string(),
      total: z.string(),
    })
    .optional(),
  lines: z.array(openingBalanceLineResponseSchema).optional(),
})

/**
 * What was carried in, read as the entry it was posted as. An organization has
 * either posted its opening balances or has not — there is no draft state — so
 * the answer is the entry itself or `posted: false`.
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
    const em = (container.resolve('em') as EntityManager).fork()
    const entry = await em.findOne(
      GlJournalEntry,
      { tenantId: auth.tenantId, organizationId, status: 'posted', entryType: 'opening' },
      { populate: ['lines', 'lines.account'] },
    )
    if (!entry) return NextResponse.json({ posted: false })
    const lines = [...entry.lines.getItems()]
      .sort((left, right) => left.lineNumber - right.lineNumber)
      .map((line) => ({
        accountId: line.account.id,
        accountCode: line.account.code,
        accountName: line.account.name,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      }))
    return NextResponse.json({
      posted: true,
      entry: {
        id: entry.id,
        entryNumber: entry.entryNumber,
        postingDate: entry.postingDate.toISOString().slice(0, 10),
        updatedAt: entry.updatedAt.toISOString(),
        total: openingBalanceTotal(lines),
      },
      lines,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    }
    logger.error('financial.opening_balances.GET failed', { err })
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to read the opening balances') },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  return runLedgerAction<z.infer<typeof postOpeningBalancesSchema>, PostOpeningBalancesResult>({
    req,
    schema: postOpeningBalancesSchema,
    commandId: OPENING_BALANCES_POST_COMMAND_ID,
    resourceKind: FINANCIAL_ENTRY_ENTITY_ID,
    // The entry does not exist before the command runs, so there is no resource
    // to name for the guards (the registry reads an absent id as `''`).
    resolveResourceId: () => '',
    fallbackError: 'Unable to post the opening balances',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Opening balances',
  methods: {
    GET: {
      summary: 'The opening entry the organization was carried in with',
      description:
        'Returns the posted entry of type `opening` and its lines, or `{ posted: false }` when none exists. Reading it needs `financial.read`.',
      responses: [{ status: 200, description: 'Opening balances', schema: openingBalancesResponseSchema }],
      errors: [
        { status: 400, description: 'Missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
    POST: {
      summary: 'Post a set of opening balances as one entry',
      description:
        'Posts one balanced journal entry of type `opening`. Refused when the organization already posted its opening balances, when the set does not balance, when the opening date has no accounting period, or when that period is closed. Carries the optimistic-lock header, so a stale updatedAt returns 409.',
      requestBody: { contentType: 'application/json', schema: postOpeningBalancesSchema },
      responses: [
        {
          status: 200,
          description: 'Opening balances posted',
          schema: z.object({
            id: z.string().uuid(),
            entryNumber: z.string(),
            postingDate: z.string(),
            updatedAt: z.string(),
            total: z.string(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid input or no period for the opening date' },
        { status: 401, description: 'Unauthorized' },
        { status: 409, description: 'Opening balances already posted or the period is closed' },
      ],
    },
  },
}
