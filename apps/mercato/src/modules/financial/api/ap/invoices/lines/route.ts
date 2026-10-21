import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ApVendorInvoice, ApVendorInvoiceLine } from '../../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

/**
 * The lines of one vendor invoice, for its detail/edit screen.
 * `ap_vendor_invoice_lines` is scoped through its invoice, so the invoice is
 * resolved in scope first and only then are its lines read.
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
      throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    }
    const invoiceId = new URL(req.url).searchParams.get('id')
    if (!invoiceId) throw new CrudHttpError(400, { error: translate('financial.errors.record_id_required', 'Record id is required.') })

    const em = (container.resolve('em') as EntityManager).fork()
    const invoice = await em.findOne(ApVendorInvoice, {
      id: invoiceId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!invoice) throw new CrudHttpError(404, { error: translate('financial.errors.vendor_invoice_not_found', 'The vendor invoice does not exist.') })
    const lines = await em.find(ApVendorInvoiceLine, { invoiceId }, { orderBy: { lineNumber: 'asc' } }) as ApVendorInvoiceLine[]
    const items = lines.map((line) => ({
      id: line.id,
      line_number: line.lineNumber,
      description: line.description,
      expense_account_id: line.expenseAccountId,
      quantity: line.quantity,
      unit_price_net: line.unitPriceNet,
      total_net_amount: line.totalNetAmount,
      tax_rate: line.taxRate,
      tax_amount: line.taxAmount,
      total_gross_amount: line.totalGrossAmount,
      tax_code: line.taxCode ?? null,
    }))
    return NextResponse.json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('financial.errors.action_failed', 'Unable to load the invoice lines') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Financial',
  summary: 'Vendor invoice lines',
  methods: {
    GET: {
      summary: 'The lines of one vendor invoice',
      responses: [{
        status: 200,
        description: 'Lines',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            line_number: z.number(),
            description: z.string(),
            expense_account_id: z.string().uuid(),
            quantity: z.string(),
            unit_price_net: z.string(),
            total_net_amount: z.string(),
            tax_rate: z.string(),
            tax_amount: z.string(),
            total_gross_amount: z.string(),
            tax_code: z.string().nullable(),
          })),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
          totalPages: z.number(),
        }),
      }],
    },
  },
}
