import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse } from 'next/server'
import '../../../config/registry'
import { templateRegistry, UnknownTemplateError } from '../../../lib/template-registry'
import { DocumentRenderer } from '../../../services/document-renderer'
import { previewSchema } from '../../../data/validators'
import { parseJsonBody, requireOrganization } from '../../_shared/http'
import { documentResponse } from '../../_shared/document-response'

const logger = createLogger('document_generators').child({ component: 'preview-route' })
const documentRenderer = new DocumentRenderer()

export const metadata = {
  path: '/document-generators/preview',
  POST: { requireAuth: true, requireFeatures: ['document_generators.view'] },
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

  const body = await parseJsonBody(request)
  if (!body.ok) return body.response

  const parsed = previewSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing template_id or data' }, { status: 400 })
  }
  const { template_id, data } = parsed.data

  const org = requireOrganization(auth)
  if (!org.ok) return org.response

  try {
    const { locale } = await resolveTranslations()
    const template = await templateRegistry.load({ id: template_id, data }, { container, auth, locale })
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
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    logger.error('Document preview render failed', { err })
    return NextResponse.json({ error: 'Failed to render document' }, { status: 500 })
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
        { status: 500, description: 'Document rendering failed' },
      ],
    },
  },
}
