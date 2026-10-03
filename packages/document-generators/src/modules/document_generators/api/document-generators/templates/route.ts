import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listTemplatesSchema, searchParamsToObject } from '../../../data/validators'
import type { TemplateFilter } from '../../../lib/interfaces'
import { templateRegistry } from '../../../lib/template-registry'
import { listAuthorizedTemplates } from '../../_shared/catalogue'
import { errorResponse, mapDocumentError } from '../../_shared/http'
import { resolveDocumentRequestContext } from '../../_shared/request-context'

const VIEW_FEATURE = 'document_generators.documents.view'

export const metadata = {
  path: '/document-generators/templates',
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const templateSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  module: z.string(),
  resourceKind: z.string(),
  documentType: z.string(),
  format: z.string(),
  tags: z.array(z.string()),
  note: z.string().optional(),
  requiredFeatures: z.array(z.string()).optional(),
})

const errorSchema = z.object({ error: z.string(), message: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'List document templates',
  methods: {
    GET: {
      operationId: 'documentGeneratorsListTemplates',
      summary: 'List the document templates the caller may use.',
      description: 'Returns registered templates filtered by the query; templates whose required features the caller lacks are omitted.',
      query: listTemplatesSchema,
      responses: [
        { status: 200, description: 'Authorized templates.', schema: z.array(templateSchema) },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters.', schema: errorSchema },
        { status: 401, description: 'Unauthenticated caller.', schema: errorSchema },
      ],
    },
  },
}

export async function GET(request: Request): Promise<Response> {
  const { container, auth, translate } = await resolveDocumentRequestContext(request)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const parsed = listTemplatesSchema.safeParse(searchParamsToObject(new URL(request.url).searchParams))
    if (!parsed.success) {
      return errorResponse('invalid_query', 400, translate, { issues: parsed.error.issues })
    }
    const filter: TemplateFilter = {
      resourceKind: parsed.data.resource_kind,
      documentType: parsed.data.document_type,
      format: parsed.data.format,
      tags: parsed.data.tags,
    }
    const templates = templateRegistry.listTemplates(filter, translate)
    const authorized = await listAuthorizedTemplates({ auth, container, request, translate, templates })
    return Response.json(authorized)
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
