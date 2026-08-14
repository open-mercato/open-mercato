import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { NextResponse } from 'next/server'
import { GenerationHistoryService } from '../../../services/generation-history-service'
import type { ListGeneratedDocumentsQuery } from '../../../services/generation-history-service'
import { listDocumentsSchema } from '../../../data/validators'

const HISTORY_SORT_FIELDS: Record<string, NonNullable<ListGeneratedDocumentsQuery['sortBy']>> = {
  resource_label: 'resourceLabel',
  template_label: 'templateLabel',
  format: 'format',
  generated_by: 'generatedBy',
  generated_at: 'generatedAt',
}

export const metadata = {
  path: '/document-generators/documents',
  GET: { requireAuth: true, requireFeatures: ['document_generators.view'] },
}

/**
 * Paginated generation history, newest first, scoped to the active organization.
 * Read logic lives in {@link GenerationHistoryService}; this route only handles HTTP.
 */
export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)

  const url = new URL(request.url)
  const parsed = listDocumentsSchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  }
  const {
    page,
    pageSize,
    resource_kind,
    resource_id,
    template_id,
    generated_by,
    generated_from,
    generated_to,
    sort,
    sort_direction,
  } = parsed.data

  // No active organization → nothing to scope to; return an empty page.
  if (!auth?.tenantId || !auth?.orgId) {
    return NextResponse.json({ items: [], total: 0, page, pageSize })
  }

  const em = container.resolve('em') as EntityManager
  const history = new GenerationHistoryService(em)
  const { items, total } = await history.listAndCount({
    scope: { organizationId: auth.orgId, tenantId: auth.tenantId },
    page,
    pageSize,
    resourceKind: resource_kind,
    resourceId: resource_id,
    templateId: template_id,
    generatedBy: generated_by,
    generatedFrom: generated_from,
    generatedTo: generated_to,
    sortBy: HISTORY_SORT_FIELDS[sort],
    sortDirection: sort_direction,
  })

  return NextResponse.json({ items, total, page, pageSize })
}

export const openApi: OpenApiRouteDoc = {
  methods: {
    GET: {
      summary: 'List generated documents with pagination, filters, and sorting',
      responses: [
        { status: 200, description: '{ items: GeneratedDocument[], total, page, pageSize }' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
