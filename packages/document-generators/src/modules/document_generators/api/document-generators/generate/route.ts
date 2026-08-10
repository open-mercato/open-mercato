import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse } from 'next/server'
import '../../../config/registry'
import { templateRegistry, UnknownTemplateError } from '../../../lib/template-registry'
import type { RenderedDocument } from '../../../lib/interfaces'
import { GenerationHistoryService } from '../../../services/generation-history-service'
import { PdfRenderingService } from '../../../services/pdf-rendering-service'
import { generateSchema } from '../../../data/validators'
import { parseJsonBody, requireOrganization } from '../../_shared/http'
import { documentResponse } from '../../_shared/document-response'

const logger = createLogger('document_generators').child({ component: 'generate-route' })

export const metadata = {
  path: '/document-generators/generate',
  POST: { requireAuth: true, requireFeatures: ['document_generators.generate'] },
}

/**
 * Generates a PDF document with full side effects — logging, events, Phase 5 history.
 * For preview-only rendering without side effects use /preview.
 *
 * @param request - `{ template_id, data, resource_kind?, resource_id? }`
 * @returns PDF binary stream
 */
export async function POST(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)

  const body = await parseJsonBody(request)
  if (!body.ok) return body.response

  const parsed = generateSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing template_id or data' }, { status: 400 })
  }
  const { template_id, data, resource_kind, resource_id } = parsed.data

  const org = requireOrganization(auth)
  if (!org.ok) return org.response

  const rendering = new PdfRenderingService()
  let rendered: RenderedDocument
  try {
    const { locale } = await resolveTranslations()
    const template = await templateRegistry.load({ id: template_id, data }, { container, auth, locale })
    rendered = await rendering.render(template)
  } catch (err) {
    if (err instanceof UnknownTemplateError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    logger.error('Document render failed', { err })
    return NextResponse.json({ error: 'Failed to render PDF document' }, { status: 500 })
  }

  // Best-effort history record — the source resource only needs kind + id.
  // The human label is derived server-side (e.g. order number), falling back to
  // the id. A persistence failure must not block the download.
  if (resource_kind && resource_id) {
    if (
      rendered.resource.id
      && (rendered.resource.kind !== resource_kind || rendered.resource.id !== resource_id)
    ) {
      return NextResponse.json({ error: 'Resource does not match the rendered document' }, { status: 400 })
    }

    const em = container.resolve('em') as EntityManager
    const history = new GenerationHistoryService(em)
    const canonicalResourceId = rendered.resource.id ?? resource_id
    try {
      await history.create({
        scope: org.value,
        templateId: rendered.template.id,
        templateLabel: rendered.template.label,
        resourceKind: rendered.resource.id ? rendered.resource.kind : resource_kind,
        resourceId: canonicalResourceId,
        resourceLabel: rendered.resource.label ?? canonicalResourceId,
        format: rendered.format,
        mimeType: rendered.mimeType,
        generatedBy: auth!.userId ?? auth!.sub,
      })
    } catch (err) {
      logger.error('Failed to persist generation history record', { err })
    }
  }

  return documentResponse(rendered)
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      summary: 'Generate PDF document with full side effects',
      responses: [
        { status: 200, description: 'PDF file stream' },
        { status: 400, description: 'Missing or invalid template_id / data' },
        { status: 401, description: 'Unauthorized' },
        { status: 409, description: 'No active organization (organization_required)' },
        { status: 500, description: 'PDF rendering failed' },
      ],
    },
  },
}
