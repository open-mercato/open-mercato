import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isSaudiVatSettingsComplete, readSaudiVatSettings } from '../../../lib/vat-settings'
import { peekNextInvoiceChain } from '../../../lib/zatca/chain'
import { createModuleConfigZatcaInvoiceChainStore } from '../../../lib/zatca/chain-store'
import { ZatcaInvoiceError } from '../../../lib/zatca/ubl'
import { buildZatcaOrderInvoice } from '../../../lib/zatca/order-invoice'
import { loadZatcaOrderSource } from '../../../lib/zatca/sales-order-source'

/**
 * Shows what a sales order's ZATCA invoice would be, without issuing anything.
 *
 * Three properties make this safe to expose:
 *
 *   - it **peeks** the chain instead of claiming a counter, so a preview can never
 *     consume an ICV or move the hash pointer (rerun it and the answer is identical);
 *   - it returns the document, the hash and the QR payload as *computed*, never stored,
 *     so there is nothing to clean up when the operator walks away;
 *   - it answers with the same status vocabulary the order panel already uses
 *     (`ready` / `settings_incomplete` / `qr_disabled` / `missing_invoice_data`), so one
 *     component can explain both, and "cannot do it" never looks like "nothing here".
 *
 * What it does not do is sign. The XAdES signature needs a CSID, so the document
 * returned here is the invoice as it exists before signing — which is the content the
 * hash is computed over, so `invoiceHash` is already the real one.
 */

const logger = createLogger('saudi_localization')

export const metadata = {
  path: '/saudi_localization/zatca/invoice-preview',
  POST: { requireAuth: true, requireFeatures: ['saudi_localization.settings.view'] },
}

const requestSchema = z.object({
  orderId: z.string().uuid(),
  subtype: z.enum(['standard', 'simplified']).optional(),
})

type PreviewContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string
}

async function resolveContext(req: Request): Promise<PreviewContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  if (!auth.orgId) {
    // The invoice chain is per organization: without one there is nothing to chain to.
    throw new CrudHttpError(400, {
      error: translate('errors.organization_required', 'Organization context is required'),
    })
  }
  return { container, tenantId: auth.tenantId, organizationId: auth.orgId }
}

async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const context = await resolveContext(req)
    const body = await readJsonSafe(req, {})
    const { orderId, subtype } = requestSchema.parse(body)

    const configService = context.container.resolve('moduleConfigService') as ModuleConfigService
    const settings = await readSaudiVatSettings(configService, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    if (!isSaudiVatSettingsComplete(settings)) {
      return NextResponse.json({ status: 'settings_incomplete', preview: true, chainMutated: false })
    }

    const resolvedSubtype = subtype ?? 'simplified'
    if (resolvedSubtype === 'simplified' && !settings.invoiceQrEnabled) {
      return NextResponse.json({ status: 'qr_disabled', preview: true, chainMutated: false })
    }

    const order = await loadZatcaOrderSource({
      em: context.container.resolve('em') as EntityManager,
      orderId,
      scope: { tenantId: context.tenantId, organizationId: context.organizationId },
    })
    if (!order) {
      return NextResponse.json(
        { error: translate('saudi_localization.errors.order_not_found', 'Sales order not found') },
        { status: 404 },
      )
    }
    if (order.lines.length === 0) {
      return NextResponse.json({ status: 'missing_invoice_data', preview: true, chainMutated: false })
    }

    const store = createModuleConfigZatcaInvoiceChainStore(configService)
    const reservation = await peekNextInvoiceChain({
      store,
      scope: { tenantId: context.tenantId, organizationId: context.organizationId },
    })

    const invoice = buildZatcaOrderInvoice({
      order,
      settings,
      icv: reservation.icv,
      previousInvoiceHash: reservation.previousInvoiceHash,
      uuid: orderId,
      subtype: resolvedSubtype,
    })

    return NextResponse.json({
      status: 'ready',
      preview: true,
      chainMutated: false,
      invoiceNumber: invoice.input.invoiceNumber,
      icv: reservation.icv,
      previousInvoiceHash: reservation.previousInvoiceHash,
      invoiceHash: invoice.document.invoiceHash,
      qrPayload: invoice.qrPayload,
      xml: invoice.xml,
      preHashXml: invoice.document.preHashXml,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof ZatcaInvoiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('errors.invalid_input', 'Invalid input'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('saudi_localization.zatca.preview failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const previewResponseSchema = z.object({
  status: z.enum(['ready', 'settings_incomplete', 'qr_disabled', 'missing_invoice_data']),
  /** Always true: this endpoint never issues an invoice. */
  preview: z.literal(true),
  /** Always false: the counter and the hash pointer are untouched. */
  chainMutated: z.literal(false),
  invoiceNumber: z.string().optional(),
  icv: z.number().int().optional(),
  previousInvoiceHash: z.string().optional(),
  invoiceHash: z.string().optional(),
  qrPayload: z.string().optional(),
  xml: z.string().optional(),
  preHashXml: z.string().optional(),
})

const postDoc: OpenApiMethodDoc = {
  summary: 'Preview the ZATCA invoice for a sales order',
  tags: ['Saudi Localization'],
  requestBody: { schema: requestSchema },
  responses: [
    { status: 200, description: 'Computed invoice, or the reason it cannot be built', schema: previewResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid request body or missing organization scope' },
    { status: 401, description: 'Unauthorized' },
    { status: 404, description: 'Sales order not found in this organization' },
    { status: 422, description: 'The order cannot be invoiced as it stands' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'ZATCA invoice preview (no issuance, no chain mutation)',
  methods: { POST: postDoc },
}

export { POST }
