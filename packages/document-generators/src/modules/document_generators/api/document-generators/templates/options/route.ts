import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { templateRegistry } from '../../../../lib/template-registry'
import { listAuthorizedTemplates } from '../../../_shared/catalogue'
import { mapDocumentError } from '../../../_shared/http'
import { resolveDocumentRequestContext } from '../../../_shared/request-context'

const VIEW_FEATURE = 'document_generators.documents.view'

export const metadata = {
  path: '/document-generators/templates/options',
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const optionsSchema = z.object({
  resourceKinds: z.array(z.string()),
  formats: z.array(z.string()),
})

const errorSchema = z.object({ error: z.string(), message: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'List document template filter options',
  methods: {
    GET: {
      operationId: 'documentGeneratorsListTemplateOptions',
      summary: 'List the resource kinds and formats of the templates the caller may use.',
      description: 'Facets are derived only from templates the caller is authorized to use.',
      responses: [
        { status: 200, description: 'Filter options.', schema: optionsSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.', schema: errorSchema },
      ],
    },
  },
}

export async function GET(request: Request): Promise<Response> {
  const { container, auth, translate } = await resolveDocumentRequestContext(request)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const templates = templateRegistry.listTemplates(undefined, translate)
    const authorized = await listAuthorizedTemplates({ auth, container, request, translate, templates })
    return Response.json(templateRegistry.listTemplateFilterOptions(authorized))
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
