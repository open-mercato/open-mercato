import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { routeErrorSchema, withDocumentsContextErrors } from '../../_shared'
import { runDocumentLifecycleRoute } from '../archive/route'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const lifecycleResponseSchema = z.object({
  id: z.string().uuid(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return runDocumentLifecycleRoute(request, context, 'documents.document.unarchive', 'documents.unarchive')
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Unarchive document',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Restore an archived document to its active editable state',
      responses: [{ status: 200, description: 'Active document state', schema: lifecycleResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Document not found', schema: routeErrorSchema },
        { status: 409, description: 'Document changed concurrently', schema: routeErrorSchema },
      ],
    },
  },
})

export default { POST }
