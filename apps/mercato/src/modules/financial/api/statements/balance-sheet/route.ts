import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ACCOUNT_CLASSES } from '../../../data/entities'
import type { FinancialLedgerService } from '../../../lib/ledgerQuery'
import { buildBalanceSheet, isStatementDate } from '../../../lib/statements'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/statements/balance-sheet',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

/**
 * The floor the sheet is read from. A balance sheet is cumulative, so the range
 * has to start before anything could have been posted; a fixed floor costs one
 * constant rather than an extra "earliest entry" lookup, and no ledger this
 * module serves predates it.
 */
const BALANCE_SHEET_START_DATE = '1900-01-01'

const statementRowSchema = z.object({
  accountId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  accountClass: z.enum(ACCOUNT_CLASSES),
  debit: z.string(),
  credit: z.string(),
})

const statementSectionSchema = z.object({
  accountClass: z.enum(ACCOUNT_CLASSES),
  rows: z.array(statementRowSchema),
  total: z.string(),
})

const balanceSheetSchema = z.object({
  asOf: z.string(),
  currencyCode: z.string().nullable(),
  assets: statementSectionSchema,
  liabilities: statementSectionSchema,
  equity: statementSectionSchema,
  totalAssets: z.string(),
  totalLiabilitiesAndEquity: z.string(),
  balanced: z.boolean(),
  netIncome: z.string(),
})

/**
 * What the books say the organization owns and owes as of a date, read from the
 * posted ledger. Revenue and expense movement to `asOf` is bridged into equity as
 * `netIncome`, so the sheet balances without a closing entry having been run, and
 * `balanced` reports the equality rather than plugging it.
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
    const asOf = new URL(req.url).searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)
    if (!isStatementDate(asOf)) {
      throw new CrudHttpError(400, { error: translate('errors.invalid_input', 'Invalid input') })
    }
    const service = container.resolve('financialLedgerService') as FinancialLedgerService
    const range = { startDate: BALANCE_SHEET_START_DATE, endDate: asOf }
    const [movements, postedCurrency] = await Promise.all([
      service.loadAccountMovements({ tenantId: auth.tenantId, organizationId }, range),
      service.resolvePostedCurrency({ tenantId: auth.tenantId, organizationId }, range),
    ])
    const sheet = buildBalanceSheet(movements, { asOf, currencyCode: postedCurrency ?? '' })
    // The builder's type names a currency because a statement normally has one;
    // a ledger with nothing posted has none, and naming one anyway would put a
    // currency on a sheet nobody transacted in.
    return NextResponse.json({ ...sheet, currencyCode: postedCurrency })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    }
    logger.error('financial.statements.balance_sheet.GET failed', { err })
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to build the balance sheet') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Balance sheet',
  methods: {
    GET: {
      summary: 'Assets, liabilities and equity as of a date',
      description:
        'Reads posted movement up to `asOf` (default: today) and nets each account by its normal balance. Retained earnings are the revenue and expense movement to that date, folded into equity. `balanced` reports whether the two totals agree; the numbers are returned either way. `currencyCode` is null when nothing was posted.',
      responses: [{ status: 200, description: 'The balance sheet', schema: balanceSheetSchema }],
      errors: [
        { status: 400, description: 'Invalid `asOf` or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
