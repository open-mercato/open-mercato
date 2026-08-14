import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse } from 'next/server'
import { templateRegistry, UnknownTemplateError } from '../../../lib/template-registry'
import { DocumentRenderer } from '../../../services/document-renderer'
import { previewSchema } from '../../../data/validators'
import { parseJsonBody, requireOrganization } from '../../_shared/http'
import { documentResponse } from '../../_shared/document-response'
import { requireTemplateAccess, TemplateAccessDeniedError } from '../../_shared/template-access'

const logger = createLogger('document_generators').child({ component: 'preview-route' })
const documentRenderer = new DocumentRenderer()

export const metadata = {
  path: '/document-generators/preview',
  POST: { requireAuth: true, requireFeatures: ['document_generators.documents.view'] },
}

/**
 * Renders a document for preview purposes — no logging, no events, no persistence.
 * Use /generate for production generation with full side effects.
 *
 * @param request - `{ template_id: TemplateId, data: unknown }`
 * @returns Document binary stream
 */
export async function POST(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const { locale, t } = await resolveTranslations()

  const body = await parseJsonBody(request, t)
  if (!body.ok) return body.response

  const parsed = previewSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'invalid_request',
      message: t('document_generators.errors.invalid_request', 'Select a template and provide valid document data.'),
    }, { status: 400 })
  }
  const { template_id, data } = parsed.data

  const org = requireOrganization(auth, t)
  if (!org.ok) return org.response

  try {
    await requireTemplateAccess(template_id, { container, auth })
    const template = await templateRegistry.load({ id: template_id, data }, { container, auth, locale, translate: t })
    const output = await documentRenderer.render(template.render)
    const rendered = {
      ...output,
      filename: template.filename,
      template: template.template,
      resource: template.resource,
    }
    return documentResponse(rendered)
  } catch (err) {
    if (err instanceof UnknownTemplateError) {
      return NextResponse.json({
        error: 'unknown_template',
        message: t('document_generators.errors.unknown_template', 'The selected document template is not available.'),
      }, { status: 400 })
    }
    if (err instanceof TemplateAccessDeniedError) {
      return NextResponse.json({
        error: 'forbidden',
        message: t('document_generators.errors.forbidden', 'You do not have permission to use this document template.'),
        requiredFeatures: err.requiredFeatures,
      }, { status: 403 })
    }
    logger.error('Document preview render failed', { err })
    return NextResponse.json({
      error: 'render_failed',
      message: t('document_generators.errors.render_failed', 'Failed to render the document.'),
    }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    POST: {
      summary: 'Render document for preview — no side effects',
      responses: [
        { status: 200, description: 'Generated document stream' },
        { status: 400, description: 'Missing or invalid template_id / data' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing a feature required by the selected template' },
        { status: 500, description: 'Document rendering failed' },
      ],
    },
  },
}
