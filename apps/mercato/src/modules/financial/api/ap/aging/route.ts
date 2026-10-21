import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildApAging, loadLedgerPayableBalance, loadOpenApInvoices } from '../../../lib/apService'
import { resolveArContext } from '../../receivables/context'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/ap/aging',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

const querySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

async function GET(req: Request) {
  try {
    const context = await resolveArContext(req)
    const url = new URL(req.url)
    const parsed = querySchema.parse({ asOf: url.searchParams.get('asOf') ?? undefined })
    const asOf = parsed.asOf ?? new Date().toISOString().slice(0, 10)
    const [invoices, ledgerBalance] = await Promise.all([
      loadOpenApInvoices(context.em, context.scope, asOf),
      loadLedgerPayableBalance(context.em, context.scope, asOf),
    ])
    return NextResponse.json(buildApAging(invoices, ledgerBalance, asOf))
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    logger.error('financial.ap.aging.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const bucketSchema = z.object({ count: z.number(), amount: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Accounts payable aging',
  methods: {
    GET: {
      summary: 'Open vendor invoices bucketed by days past due',
      responses: [{
        status: 200,
        description: 'Aging',
        schema: z.object({
          asOf: z.string(),
          currencyCode: z.string().nullable(),
          buckets: z.object({
            current: bucketSchema,
            days1to30: bucketSchema,
            days31to60: bucketSchema,
            days61to90: bucketSchema,
            days90plus: bucketSchema,
          }),
          totalOutstanding: z.string(),
          ledgerBalance: z.string(),
          reconciliationDelta: z.string(),
          invoiceCount: z.number(),
          invoices: z.array(z.object({
            id: z.string().uuid(),
            internalNumber: z.string(),
            vendorId: z.string().uuid(),
            vendorName: z.string().nullable(),
            issueDate: z.string().nullable(),
            dueDate: z.string().nullable(),
            currencyCode: z.string(),
            grossAmount: z.string(),
            paidAmount: z.string(),
            outstandingAmount: z.string(),
            bucket: z.string(),
          })),
        }),
      }],
    },
  },
}

export { GET }
