import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesQuote, SalesQuoteLine, SalesQuoteAdjustment } from '../../../../data/entities'

const paramsSchema = z.object({
  token: z.string().uuid(),
})

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(_req: Request, ctx: { params: { token: string } }) {
  try {
    const { token } = paramsSchema.parse(ctx.params ?? {})
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const quote = await em.findOne(SalesQuote, { acceptanceToken: token, deletedAt: null })
    const { translate } = await resolveTranslations()
    if (!quote) {
      throw new CrudHttpError(404, { error: translate('sales.quotes.public.notFound', 'Quote not found.') })
    }

    const now = new Date()
    const isExpired = !!quote.validUntil && quote.validUntil.getTime() < now.getTime()

    const [lines, adjustments] = await Promise.all([
      em.find(SalesQuoteLine, { quote: quote.id, deletedAt: null }, { orderBy: { lineNumber: 'asc' } }),
      em.find(SalesQuoteAdjustment, { quote: quote.id }, { orderBy: { position: 'asc' } }),
    ])

    return NextResponse.json({
      quote: {
        quoteNumber: quote.quoteNumber,
        currencyCode: quote.currencyCode,
        validFrom: quote.validFrom?.toISOString() ?? null,
        validUntil: quote.validUntil?.toISOString() ?? null,
        status: quote.status ?? null,
        subtotalNetAmount: quote.subtotalNetAmount,
        subtotalGrossAmount: quote.subtotalGrossAmount,
        discountTotalAmount: quote.discountTotalAmount,
        taxTotalAmount: quote.taxTotalAmount,
        grandTotalNetAmount: quote.grandTotalNetAmount,
        grandTotalGrossAmount: quote.grandTotalGrossAmount,
      },
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber ?? null,
        kind: line.kind,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        quantityUnit: line.quantityUnit ?? null,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        discountAmount: line.discountAmount,
        discountPercent: line.discountPercent,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
      })),
      adjustments: adjustments.map((adj) => ({
        scope: adj.scope,
        kind: adj.kind,
        label: adj.label ?? adj.code ?? null,
        rate: adj.rate,
        amountNet: adj.amountNet,
        amountGross: adj.amountGross,
        currencyCode: adj.currencyCode ?? null,
        position: adj.position ?? null,
        quoteLineId: adj.quoteLine?.id ?? null,
      })),
      isExpired,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.quotes.public failed', err)
    return NextResponse.json({ error: translate('sales.quotes.public.failed', 'Failed to load quote.') }, { status: 400 })
  }
}

const publicQuoteResponseSchema = z.object({
  quote: z.object({
    quoteNumber: z.string(),
    currencyCode: z.string(),
    validFrom: z.string().nullable(),
    validUntil: z.string().nullable(),
    status: z.string().nullable(),
    subtotalNetAmount: z.string(),
    subtotalGrossAmount: z.string(),
    discountTotalAmount: z.string(),
    taxTotalAmount: z.string(),
    grandTotalNetAmount: z.string(),
    grandTotalGrossAmount: z.string(),
  }),
  lines: z.array(
    z.object({
      lineNumber: z.number().nullable(),
      kind: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable(),
      quantity: z.string(),
      quantityUnit: z.string().nullable(),
      currencyCode: z.string(),
      totalGrossAmount: z.string(),
    })
  ),
  adjustments: z.array(
    z.object({
      scope: z.string().nullable(),
      kind: z.string().nullable(),
      label: z.string().nullable(),
      rate: z.string().nullable(),
      amountNet: z.string().nullable(),
      amountGross: z.string().nullable(),
    })
  ),
  isExpired: z.boolean(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'View a quote (public)',
  pathParams: z.object({ token: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get quote details by acceptance token',
      responses: [
        { status: 200, description: 'Quote details', schema: publicQuoteResponseSchema },
        { status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
