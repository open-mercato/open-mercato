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
import { FinancialRuleError, financialFallbackMessage } from '../../../lib/errors'
import type { FinancialLedgerService } from '../../../lib/ledgerQuery'
import { buildIncomeStatement } from '../../../lib/statements'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/statements/income-statement',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

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

const incomeStatementSchema = z.object({
  from: z.string(),
  to: z.string(),
  currencyCode: z.string().nullable(),
  revenue: statementSectionSchema,
  expenses: statementSectionSchema,
  totalRevenue: z.string(),
  totalExpenses: z.string(),
  netIncome: z.string(),
})

/**
 * Did the organization make money over a range, read from the posted ledger.
 * Revenue and expenses are netted by their normal balance; a loss is a negative
 * `netIncome` rather than a sign the caller has to infer from the totals.
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
    const today = new Date().toISOString().slice(0, 10)
    const params = new URL(req.url).searchParams
    // The year to date is the range a caller asks for when they ask for nothing:
    // "how are we doing" is a question about the current financial year.
    const from = params.get('from') ?? `${today.slice(0, 4)}-01-01`
    const to = params.get('to') ?? today
    const service = container.resolve('financialLedgerService') as FinancialLedgerService
    const scope = { tenantId: auth.tenantId, organizationId }
    const range = { startDate: from, endDate: to }
    const [movements, postedCurrency] = await Promise.all([
      service.loadAccountMovements(scope, range),
      service.resolvePostedCurrency(scope, range),
    ])
    // A reversed or malformed range is refused by the statement itself; nothing
    // is loaded into it and the caller gets `statement_range_invalid`.
    const statement = buildIncomeStatement(movements, { from, to, currencyCode: postedCurrency ?? '' })
    return NextResponse.json({ ...statement, currencyCode: postedCurrency })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof FinancialRuleError) {
      return NextResponse.json(
        { error: translate(`financial.errors.${err.code}`, financialFallbackMessage(err.code)) },
        { status: 400 },
      )
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input') }, { status: 400 })
    }
    logger.error('financial.statements.income_statement.GET failed', { err })
    return NextResponse.json(
      { error: translate('financial.errors.action_failed', 'Unable to build the income statement') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Income statement',
  methods: {
    GET: {
      summary: 'Revenue and expenses over a range',
      description:
        'Reads posted movement between `from` and `to` (inclusive), defaulting to the current calendar year’s first day through today. Nets each account by its normal balance; a loss is a negative `netIncome`. Refuses a range whose end precedes its start. `currencyCode` is null when nothing was posted.',
      responses: [{ status: 200, description: 'The income statement', schema: incomeStatementSchema }],
      errors: [
        { status: 400, description: 'A malformed or reversed range, or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
