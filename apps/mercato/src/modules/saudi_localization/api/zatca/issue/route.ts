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
import { issueSaudiInvoice, SaudiIssuanceError } from '../../../lib/zatca/issuance'
import { ZatcaInvoiceError } from '../../../lib/zatca/ubl'

const logger = createLogger('saudi_localization')

export const metadata = {
  path: '/saudi_localization/zatca/issue',
  POST: { requireAuth: true, requireFeatures: ['saudi_localization.einvoicing.issue'] },
}

const requestSchema = z.object({
  orderId: z.string().uuid(),
  subtype: z.enum(['standard', 'simplified']).optional(),
})

async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    if (!auth.orgId) {
      throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    }
    const body = await readJsonSafe(req, {})
    const input = requestSchema.parse(body)
    const result = await issueSaudiInvoice({
      em: container.resolve('em') as EntityManager,
      configService: container.resolve('moduleConfigService') as ModuleConfigService,
      scope: { tenantId: auth.tenantId, organizationId: auth.orgId },
      orderId: input.orderId,
      subtype: input.subtype,
      actorUserId: auth.sub ?? null,
    })
    const submission = result.submission
    return NextResponse.json({
      id: submission.id,
      status: submission.status,
      reused: result.reused,
      invoiceNumber: submission.invoiceNumber,
      icv: submission.icv,
      previousInvoiceHash: submission.previousInvoiceHash,
      invoiceHash: submission.invoiceHash,
      qrPayload: submission.qrPayload,
      xml: submission.xml,
      signed: false,
      submittedToZatca: false,
      note: translate(
        'saudi_localization.einvoicing.pending_note',
        'The invoice is persisted locally. Cryptographic signing and ZATCA submission require CSID onboarding.',
      ),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof SaudiIssuanceError) {
      const status = err.code === 'order_not_found'
        ? 404
        : err.code === 'missing_invoice_data'
          ? 422
          : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    if (err instanceof ZatcaInvoiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: translate('errors.invalid_input', 'Invalid input'), details: err.issues },
        { status: 400 },
      )
    }
    logger.error('saudi_localization.zatca.issue failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const responseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'submitted', 'cleared', 'rejected']),
  reused: z.boolean(),
  invoiceNumber: z.string(),
  icv: z.number(),
  previousInvoiceHash: z.string(),
  invoiceHash: z.string(),
  qrPayload: z.string(),
  xml: z.string(),
  signed: z.boolean(),
  submittedToZatca: z.boolean(),
  note: z.string(),
})

const postDoc: OpenApiMethodDoc = {
  summary: 'Issue and persist a ZATCA invoice for a sales order',
  description:
    'Claims the next ICV, builds the UBL document and persists the exact XML/hash. It does not sign or transmit; the submission stays pending until CSID onboarding and sandbox validation exist.',
  requestBody: { contentType: 'application/json', schema: requestSchema },
  responses: [{ status: 200, description: 'Issued locally', schema: responseSchema }],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Saudi Localization',
  summary: 'ZATCA issuance',
  methods: { POST: postDoc },
}

export { POST }
