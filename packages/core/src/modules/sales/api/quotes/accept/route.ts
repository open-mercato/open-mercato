import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '../../../data/entities'
import { quoteAcceptSchema } from '../../../data/validators'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { resolveStatusEntryIdByValue } from '../../../lib/statusHelpers'
import { QuoteAcceptedAdminEmail } from '../../../emails/QuoteAcceptedAdminEmail'

type ConvertToOrderResult = {
  result?: { orderId?: string } | null
  orderId?: string
}

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request) {
  try {
    const { token } = quoteAcceptSchema.parse(await req.json().catch(() => ({})))
    const container = await createRequestContainer()
    const em = (container.resolve('em') as EntityManager).fork()
    const { translate } = await resolveTranslations()

    const quote = await em.findOne(SalesQuote, { acceptanceToken: token, deletedAt: null })
    if (!quote) {
      throw new CrudHttpError(404, { error: translate('sales.quotes.accept.notFound', 'Quote not found.') })
    }

    const now = new Date()
    if (quote.validUntil && quote.validUntil.getTime() < now.getTime()) {
      throw new CrudHttpError(400, { error: translate('sales.quotes.accept.expired', 'This quote has expired.') })
    }

    if ((quote.status ?? null) !== 'sent') {
      throw new CrudHttpError(400, {
        error: translate('sales.quotes.accept.invalidStatus', 'This quote cannot be accepted in its current status.'),
      })
    }

    // Mark accepted before conversion so the created order inherits the confirmed status.
    quote.status = 'confirmed'
    quote.statusEntryId = await resolveStatusEntryIdByValue(em, {
      tenantId: quote.tenantId,
      organizationId: quote.organizationId,
      value: 'confirmed',
    })
    quote.updatedAt = now
    em.persist(quote)
    await em.flush()

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: quote.organizationId,
      organizationIds: [quote.organizationId],
      request: req,
    }

    const result = (await commandBus.execute('sales.quotes.convert_to_order', { input: { quoteId: quote.id }, ctx })) as ConvertToOrderResult | null
    const orderId = result?.result?.orderId ?? result?.orderId ?? quote.id

    const order = await em.findOne(SalesOrder, { id: orderId, deletedAt: null })
    const orderNumber = order?.orderNumber ?? orderId

    // Admin notification should not block acceptance.
    const adminEmail = process.env.ADMIN_EMAIL || ''
    if (adminEmail) {
      try {
        const appUrl = process.env.APP_URL || ''
        const orderUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/backend/sales/orders/${orderId}` : `/backend/sales/orders/${orderId}`

        const copy = {
          preview: translate('sales.quotes.accept.adminEmail.preview', 'Quote {quoteNumber} accepted', { quoteNumber: quote.quoteNumber }),
          heading: translate('sales.quotes.accept.adminEmail.heading', 'Quote {quoteNumber} accepted', { quoteNumber: quote.quoteNumber }),
          body: translate('sales.quotes.accept.adminEmail.body', 'The customer accepted quote {quoteNumber}. An order has been created: {orderNumber}.', {
            quoteNumber: quote.quoteNumber,
            orderNumber,
          }),
          cta: translate('sales.quotes.accept.adminEmail.cta', 'View order'),
          footer: translate('sales.quotes.accept.adminEmail.footer', 'Open Mercato'),
        }

        await sendEmail({
          to: adminEmail,
          subject: translate('sales.quotes.accept.adminSubject', 'Quote {quoteNumber} accepted → Order {orderNumber}', {
            quoteNumber: quote.quoteNumber,
            orderNumber,
          }),
          react: QuoteAcceptedAdminEmail({ orderUrl, copy }),
        })
      } catch (err) {
        console.error('sales.quotes.accept.adminEmail failed', err)
      }
    }

    return NextResponse.json({ orderId, orderNumber })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('sales.quotes.accept failed', err)
    return NextResponse.json({ error: translate('sales.quotes.accept.failed', 'Failed to accept quote.') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Accept a quote (public)',
  methods: {
    POST: {
      summary: 'Accept quote and convert to order',
      requestBody: {
        contentType: 'application/json',
        schema: quoteAcceptSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Quote accepted and order created',
          schema: z.object({ orderId: z.string().uuid(), orderNumber: z.string() }),
        },
        { status: 400, description: 'Invalid or expired quote', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
