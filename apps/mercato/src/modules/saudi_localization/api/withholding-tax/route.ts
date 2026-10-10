import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveFinancialCountryPlugin } from '@/modules/financial/lib/registries'
import { resolveLedgerService, resolveSaudiApiContext, readSettings } from '../../lib/api-context'
import { resolveSaudiFilingPeriod, saudiFilingQuerySchema } from '../../lib/saudi/filing-period'
import { SAUDI_CURRENCY_CODE, SAUDI_COUNTRY_CODE } from '../../lib/saudi/number-format'
import { SAUDI_WITHHOLDING_CATEGORIES } from '../../lib/saudi/tax-codes'
import { buildSaudiWithholdingSummary } from '../../lib/saudi/withholding'

/**
 * Withholding tax for a period: the published catalogue, and what the ledger
 * actually holds against it.
 *
 * The two halves are reported together on purpose. The catalogue alone would tell
 * an operator the rates but not whether anything was withheld; the summary alone
 * would show an amount with no rate to check it against. A category that was
 * withheld against but is missing from the catalogue cannot appear here at all —
 * the payment path refuses an unknown category rather than withholding nothing.
 */
const logger = createLogger('saudi_localization')

export const metadata = {
  path: '/saudi_localization/withholding-tax',
  GET: { requireAuth: true, requireFeatures: ['saudi_localization.withholding.view'] },
}

async function GET(req: Request) {
  try {
    const context = await resolveSaudiApiContext(req)
    const url = new URL(req.url)
    const query = saudiFilingQuerySchema.parse(buildQueryParams(url.searchParams))

    const settings = await readSettings(context)
    const plugin = resolveFinancialCountryPlugin(SAUDI_COUNTRY_CODE)
    const period = resolveSaudiFilingPeriod({
      calendar: plugin.fiscalCalendar,
      query,
      fallbackFrequency: settings.filingFrequency,
    })

    const lines = await resolveLedgerService(context).loadPostedTaxLines(context.scope, {
      startDate: period.startDate,
      endDate: period.endDate,
    })

    const summary = buildSaudiWithholdingSummary(lines, SAUDI_CURRENCY_CODE)

    return NextResponse.json({
      period,
      currencyCode: SAUDI_CURRENCY_CODE,
      catalogue: SAUDI_WITHHOLDING_CATEGORIES,
      summary,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        { error: translate('errors.invalid_input', 'Invalid input'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('saudi_localization.withholding.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  period: z.object({
    frequency: z.enum(['monthly', 'quarterly', 'annual']),
    fiscalYear: z.number().int(),
    periodNumber: z.number().int(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  currencyCode: z.string(),
  catalogue: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      rate: z.number(),
      payableAccountCode: z.string(),
    }),
  ),
  summary: z.object({
    currencyCode: z.string(),
    total: z.string(),
    rows: z.array(
      z.object({
        categoryCode: z.string(),
        label: z.string(),
        rate: z.number(),
        amount: z.string(),
        lineCount: z.number().int(),
      }),
    ),
  }),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Saudi withholding tax catalogue and period summary',
  description:
    'Returns the published withholding categories with their rates, and the amount the ledger holds against each for the period.',
  tags: ['Saudi Localization'],
  responses: [{ status: 200, description: 'Catalogue and period summary', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Invalid query or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'Saudi withholding tax (catalogue + ledger summary)',
  methods: { GET: getDoc },
}

export { GET }
