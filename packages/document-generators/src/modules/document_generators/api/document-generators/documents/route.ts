import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listDocumentsSchema, searchParamsToObject } from '../../../data/validators'
import { GenerationHistoryService } from '../../../services/generation-history-service'
import { errorResponse, mapDocumentError, requireOrganization } from '../../_shared/http'
import { resolveDocumentRequestContext } from '../../_shared/request-context'

const VIEW_FEATURE = 'document_generators.documents.view'

export const metadata = {
  path: '/document-generators/documents',
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

const documentSchema = z.object({
  id: z.string().uuid(),
  resourceKind: z.string(),
  resourceId: z.string(),
  resourceLabel: z.string(),
  templateId: z.string(),
  templateLabel: z.string(),
  format: z.string(),
  generatedBy: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }),
})

const pageSchema = z.object({
  items: z.array(documentSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

const errorSchema = z.object({ error: z.string(), message: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Document Generators',
  summary: 'List generated documents',
  methods: {
    GET: {
      operationId: 'documentGeneratorsListDocuments',
      summary: 'List the generation history of the selected organization.',
      description: 'Returns a page of generated document history entries scoped to the active tenant and organization. Responds with an empty page when no organization is selected.',
      query: listDocumentsSchema,
      responses: [
        { status: 200, description: 'A page of generated documents.', schema: pageSchema },
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
    const parsed = listDocumentsSchema.safeParse(searchParamsToObject(new URL(request.url).searchParams))
    if (!parsed.success) return errorResponse('invalid_query', 400, translate)
    const organization = await requireOrganization({ auth, container, request, translate })
    if (!organization.ok) {
      return Response.json({ items: [], total: 0, page: parsed.data.page, pageSize: parsed.data.pageSize })
    }
    const service = new GenerationHistoryService(container.resolve('em') as EntityManager)
    const page = await service.listAndCount(organization.scope, parsed.data)
    return Response.json(page)
  } catch (error) {
    return mapDocumentError(error, translate)
  }
}
