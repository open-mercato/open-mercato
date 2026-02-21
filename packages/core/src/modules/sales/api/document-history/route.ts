import { z } from 'zod'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { loadAuditLogDisplayMaps } from '@open-mercato/core/modules/audit_logs/api/audit-logs/display'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildHistoryEntries } from '../../lib/historyHelpers'

// Spec: SPEC-006-2026-01-23-order-status-history

export const metadata = {
  GET: { requireAuth: true },
}

const querySchema = z.object({
  kind: z.enum(['order', 'quote']),
  id: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
  types: z.string().optional(), // comma-separated: status,action,comment
})

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
      })
    }

    const resourceKind = query.kind === 'order' ? 'sales.order' : 'sales.quote'

    const actionLogService = container.resolve('actionLogService') as ActionLogService
    const em = (container.resolve('em') as EntityManager).fork()

    const logs = await actionLogService.list({
      tenantId: auth.tenantId,
      organizationId,
      resourceKind,
      resourceId: query.id,
      limit: query.limit,
      before: query.before ? new Date(query.before) : undefined,
      after: query.after ? new Date(query.after) : undefined,
    }) as ActionLog[]

    const displayMaps = await loadAuditLogDisplayMaps(em, {
      userIds: logs.map((l) => l.actorUserId).filter((v): v is string => !!v),
      tenantIds: [],
      organizationIds: [],
    })

    const items = buildHistoryEntries({ actionLogs: logs, kind: query.kind, displayUsers: displayMaps.users })

    let nextCursor: string | undefined = undefined
    if (logs.length === query.limit && items.length > 0) {
      const last = items[items.length - 1]
      nextCursor = Buffer.from(`${last.occurredAt}|${last.id}`).toString('base64')
    }

    return NextResponse.json({ items, nextCursor })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.document-history.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('sales.documents.history.error', 'Failed to load history.') },
      { status: 400 }
    )
  }
}

const historyActorSchema = z.object({
  id: z.string().uuid().nullable(),
  label: z.string(),
})

const historyEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  kind: z.enum(['status', 'action', 'comment']),
  action: z.string(),
  actor: historyActorSchema,
  source: z.enum(['action_log', 'note']),
  metadata: z.object({
    statusFrom: z.string().nullable().optional(),
    statusTo: z.string().nullable().optional(),
    documentKind: z.enum(['order', 'quote']).optional(),
    commandId: z.string().optional(),
  }).optional(),
})

const documentHistoryResponseSchema = z.object({
  items: z.array(historyEntrySchema),
  nextCursor: z.string().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Get document change history',
  methods: {
    GET: {
      summary: 'List history entries for an order or quote',
      query: querySchema,
      responses: [
        { status: 200, description: 'History entries', schema: documentHistoryResponseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Document not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
