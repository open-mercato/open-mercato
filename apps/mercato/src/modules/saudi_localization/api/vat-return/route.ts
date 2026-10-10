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
import { SAUDI_COUNTRY_CODE } from '../../lib/saudi/number-format'
import eventsConfig from '../../events'

/**
 * The ZATCA VAT return for a filing period, read from the posted ledger.
 *
 * Read-only in the strict sense: it posts nothing, writes nothing and files
 * nothing. What it does own is the answer to "do my books and my return agree" —
 * the response carries the reconciliation delta, so a period whose VAT was posted
 * without its taxable base says so instead of looking tidy.
 */
const logger = createLogger('saudi_localization')
const emitSaudiEvent = eventsConfig.emit

export const metadata = {
  path: '/saudi_localization/vat-return',
  GET: { requireAuth: true, requireFeatures: ['saudi_localization.vat_return.view'] },
}

async function GET(req: Request) {
  try {
    const context = await resolveSaudiApiContext(req)
    const url = new URL(req.url)
    const query = saudiFilingQuerySchema.parse(buildQueryParams(url.searchParams))

    const settings = await readSettings(context)
    const plugin = resolveFinancialCountryPlugin(SAUDI_COUNTRY_CODE)
    const reporting = plugin.taxReporting
    if (!reporting) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        {
          error: translate(
            'saudi_localization.errors.no_tax_reporting',
            'Tax reporting is not available for this jurisdiction.',
          ),
        },
        { status: 409 },
      )
    }

    const period = resolveSaudiFilingPeriod({
      calendar: plugin.fiscalCalendar,
      query,
      fallbackFrequency: settings.filingFrequency,
    })

    const lines = await resolveLedgerService(context).loadPostedTaxLines(context.scope, {
      startDate: period.startDate,
      endDate: period.endDate,
    })

    const generatedAt = new Date().toISOString()
    const taxReturn = reporting.buildReturn({
      period,
      frequency: period.frequency,
      lines,
      generatedAt,
    })

    // Nothing was written, but "which figures were reported, and when" is what an
    // audit asks for, so the read is recorded on the bus rather than lost.
    await emitSaudiEvent('saudi_localization.vat_return.generated', {
      fiscalYear: period.fiscalYear,
      frequency: period.frequency,
      periodNumber: period.periodNumber,
      periodLabel: period.label,
      netPayable: taxReturn.netPayable,
      reconciliationDelta: taxReturn.reconciliationDelta,
      lineCount: taxReturn.lineCount,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })

    // The seller identity travels with the figures so a screen can say which VAT
    // number they were read against — a return filed under the wrong number is
    // filed in the wrong name.
    return NextResponse.json({
      ...taxReturn,
      settings: {
        sellerName: settings.sellerName,
        vatRegistrationNumber: settings.vatRegistrationNumber,
        filingFrequency: settings.filingFrequency,
        isComplete: settings.sellerName.trim().length > 0 && settings.vatRegistrationNumber.trim().length > 0,
      },
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
    logger.error('saudi_localization.vat_return.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const returnSchema = z.object({
  countryCode: z.string(),
  currencyCode: z.string(),
  period: z.object({
    fiscalYear: z.number().int(),
    frequency: z.enum(['monthly', 'quarterly', 'annual']),
    periodNumber: z.number().int(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  standardRated: z.object({ net: z.string(), tax: z.string() }),
  zeroRated: z.object({ net: z.string() }),
  exempt: z.object({ net: z.string() }),
  outOfScope: z.object({ net: z.string() }),
  outputVat: z.string(),
  inputVat: z.string(),
  netPayable: z.string(),
  lineCount: z.number().int(),
  reconciliationDelta: z.string(),
  generatedAt: z.string(),
  settings: z.object({
    sellerName: z.string(),
    vatRegistrationNumber: z.string(),
    filingFrequency: z.enum(['monthly', 'quarterly']),
    isComplete: z.boolean(),
  }),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Saudi VAT return for a filing period',
  description:
    'Groups the period’s posted tax lines by ZATCA category. Posts nothing; the reconciliation delta reports any difference between the posted output VAT and the tax the standard-rated base implies.',
  tags: ['Saudi Localization'],
  responses: [{ status: 200, description: 'The period’s return', schema: returnSchema }],
  errors: [
    { status: 400, description: 'Invalid query or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
    { status: 409, description: 'The jurisdiction has no tax reporting' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'ZATCA VAT return (read model over posted tax lines)',
  methods: { GET: getDoc },
}

export { GET }
