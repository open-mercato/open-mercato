import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveSaudiApiContext } from '../../lib/api-context'
import { SAUDI_CURRENCY_CODE } from '../../lib/saudi/number-format'
import {
  SAUDI_ZAKAT_GREGORIAN_RATE,
  SAUDI_ZAKAT_HIJRI_RATE,
  computeSaudiZakatBase,
} from '../../lib/saudi/zakat'

/**
 * The zakat base for a set of assessment figures the caller supplies.
 *
 * The figures are **inputs, not a ledger read**, and that is deliberate: zakat is
 * assessed on a mix of book values and adjustments an accountant determines, and
 * a route that guessed them from account balances would produce a number that
 * looks authoritative and is wrong. Every figure is therefore named in the query,
 * echoed back in the response, and the base is arithmetic over exactly those
 * numbers.
 *
 * What is deliberately not here: the ownership mix (Saudi/GCC share), the full
 * additions and deductions schedules and the year-length adjustment. A caller
 * that needs those applies them to the figures it sends.
 */
const logger = createLogger('saudi_localization')

export const metadata = {
  path: '/saudi_localization/zakat-base',
  GET: { requireAuth: true, requireFeatures: ['saudi_localization.zakat.view'] },
}

const amount = z.coerce.number().min(-1e15).max(1e15)

const zakatQuerySchema = z.object({
  shareCapital: amount,
  statutoryReserves: amount.default(0),
  retainedEarnings: amount.default(0),
  provisions: amount.default(0),
  longTermLiabilities: amount.default(0),
  fixedAssets: amount.default(0),
  intangibleAssets: amount.default(0),
  additions: amount.optional(),
  deductions: amount.optional(),
  /** `hijri` selects the 2.577% equivalent for a Hijri-year filer. */
  yearBasis: z.enum(['gregorian', 'hijri']).default('gregorian'),
})

async function GET(req: Request) {
  try {
    await resolveSaudiApiContext(req)
    const url = new URL(req.url)
    const query = zakatQuerySchema.parse(buildQueryParams(url.searchParams))

    const result = computeSaudiZakatBase(
      {
        shareCapital: query.shareCapital,
        statutoryReserves: query.statutoryReserves,
        retainedEarnings: query.retainedEarnings,
        provisions: query.provisions,
        longTermLiabilities: query.longTermLiabilities,
        fixedAssets: query.fixedAssets,
        intangibleAssets: query.intangibleAssets,
        ...(query.additions === undefined ? {} : { additions: query.additions }),
        ...(query.deductions === undefined ? {} : { deductions: query.deductions }),
      },
      {
        rate: query.yearBasis === 'hijri' ? SAUDI_ZAKAT_HIJRI_RATE : SAUDI_ZAKAT_GREGORIAN_RATE,
      },
    )

    return NextResponse.json({
      currencyCode: SAUDI_CURRENCY_CODE,
      yearBasis: query.yearBasis,
      /** Echoed so the filed base can be traced to the figures it came from. */
      inputs: {
        shareCapital: query.shareCapital,
        statutoryReserves: query.statutoryReserves,
        retainedEarnings: query.retainedEarnings,
        provisions: query.provisions,
        longTermLiabilities: query.longTermLiabilities,
        fixedAssets: query.fixedAssets,
        intangibleAssets: query.intangibleAssets,
        additions: query.additions ?? 0,
        deductions: query.deductions ?? 0,
      },
      ...result,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json(
        {
          error: translate('saudi_localization.errors.invalid_zakat_input', 'Invalid zakat assessment figures'),
          details: err.issues,
        },
        { status: 400 },
      )
    }
    logger.error('saudi_localization.zakat_base.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  currencyCode: z.string(),
  yearBasis: z.enum(['gregorian', 'hijri']),
  inputs: z.record(z.string(), z.number()),
  sourcesOfFunds: z.string(),
  deductions: z.string(),
  zakatBase: z.string(),
  rate: z.number(),
  zakatDue: z.string(),
  filingFrequency: z.literal('annual'),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'Saudi zakat base and due amount',
  description:
    'Computes the zakat base from the assessment figures supplied in the query. Groundwork only: the ownership mix and the full additions/deductions schedules are the tenant’s assessment.',
  tags: ['Saudi Localization'],
  responses: [{ status: 200, description: 'The computed base and the figures it used', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Invalid assessment figures or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'Saudi zakat base (groundwork)',
  methods: { GET: getDoc },
}

export { GET }
