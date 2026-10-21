import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCustomerStatement } from '../../../lib/arService'
import { resolveArContext } from '../context'

const logger = createLogger('financial')

export const metadata = {
  path: '/financial/receivables/statements',
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

const querySchema = z.object({
  customerId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

async function GET(req: Request) {
  try {
    const context = await resolveArContext(req)
    const url = new URL(req.url)
    const parsed = querySchema.parse({
      customerId: url.searchParams.get('customerId') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    })
    const statement = await loadCustomerStatement(context.em, context.scope, parsed.customerId, {
      from: parsed.from ?? null,
      to: parsed.to ?? null,
    })
    return NextResponse.json(statement)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    logger.error('financial.receivables.statements.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Customer account statement',
  methods: {
    GET: {
      summary: 'Invoices and payments for one customer',
      responses: [{
        status: 200,
        description: 'Statement',
        schema: z.object({
          customerId: z.string().uuid(),
          from: z.string().nullable(),
          to: z.string().nullable(),
          currencyCode: z.string().nullable(),
          openingBalance: z.string(),
          totalDebits: z.string(),
          totalCredits: z.string(),
          closingBalance: z.string(),
          lines: z.array(z.object({
            id: z.string().uuid(),
            kind: z.enum(['invoice', 'payment']),
            reference: z.string().nullable(),
            occurredAt: z.string(),
            debit: z.string(),
            credit: z.string(),
          })),
        }),
      }],
    },
  },
}

export { GET }
