import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { previewSchema } from '../../../data/validators'
import { templateRegistry } from '../../../lib/template-registry'
import { TemplateAccessPolicy, type TemplateFeatureAuthorizer } from '../../../lib/template-access-policy'
import { resolveDocumentGeneratorsConfig } from '../../../lib/module-config'
import { DocumentRenderer } from '../../../services/document-renderer'
import { documentResponse } from '../../_shared/document-response'
import { errorResponse, mapDocumentError, parseJsonBody, requireOrganization, toTemplateTranslate } from '../../_shared/http'
import { resolveDocumentRequestContext } from '../../_shared/request-context'

const VIEW_FEATURE = 'document_generators.documents.view'

export const metadata = {
  path: '/document-generators/preview',
  POST: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const errorSchema = z.object({ error: z.string(), message: z.string() })
const forbiddenSchema = errorSchema.extend({ requiredFeatures: z.array(z.string()) })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'Preview a document',
  methods: {
    POST: {
      operationId: 'documentGeneratorsPreview',
      summary: 'Render a document without saving it.',
      description: 'Renders the template for the given source data and returns the document bytes. Nothing is persisted and no events are emitted.',
      requestBody: { contentType: 'application/json', schema: previewSchema },
      responses: [
        {
          status: 200,
          description: 'The rendered document (application/pdf or text/markdown).',
          mediaType: 'application/octet-stream',
          schema: z.string().describe('Binary document content'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid JSON, invalid request, unknown template or invalid source reference.', schema: errorSchema },
        { status: 401, description: 'Unauthenticated caller.', schema: errorSchema },
        { status: 403, description: 'The caller lacks the features required by the template.', schema: forbiddenSchema },
        { status: 404, description: 'Document source not found.', schema: errorSchema },
        { status: 409, description: 'An organization must be selected.', schema: errorSchema },
        { status: 500, description: 'Rendering failed.', schema: errorSchema },
      ],
    },
  },
}

export async function POST(request: Request): Promise<Response> {
  const { container, auth, translate, locale } = await resolveDocumentRequestContext(request)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await parseJsonBody(request, translate)
    if (!body.ok) return body.response
    const parsed = previewSchema.safeParse(body.body)
    if (!parsed.success) {
      return errorResponse('invalid_request', 400, translate, { issues: parsed.error.issues })
    }
    const organization = await requireOrganization({ auth, container, request, translate })
    if (!organization.ok) return organization.response
    const template = templateRegistry.getTemplateMetadata(parsed.data.template_id, translate)
    const policy = new TemplateAccessPolicy({
      featureAuthorizer: container.resolve('rbacService') as TemplateFeatureAuthorizer,
      auth: organization.auth,
    })
    await policy.requireAccess({ requiredFeatures: template.requiredFeatures })
    const loaded = await templateRegistry.load(
      { id: parsed.data.template_id, data: parsed.data.data, version: parsed.data.template_version },
      { container, auth: organization.auth, locale, translate: toTemplateTranslate(translate) },
    )
    const rendered = await new DocumentRenderer().render(loaded.render, { config: resolveDocumentGeneratorsConfig(container) })
    return documentResponse({ buffer: rendered.buffer, filename: loaded.filename, mimeType: rendered.mimeType })
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
