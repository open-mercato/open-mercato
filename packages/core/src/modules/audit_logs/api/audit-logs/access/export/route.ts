import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { defaultExportFilename, serializeExport, type PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import { loadAuditLogDisplayMaps } from '../../display'
import { requireResolvedTenantScope } from '../../readScope'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

const exportQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  resourceKind: z.string().optional(),
  resourceId: z.string().optional(),
  accessType: z.string().optional(),
  limit: z.string().optional(),
  before: z.string().optional(),
  after: z.string().optional(),
})

const responseSchema = z.object({ file: z.literal('csv') })
const errorSchema = z.object({ error: z.string() })

function parseLimit(value: string | null): number {
  if (!value) return 1000
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 1000) : 1000
}

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp)
}

function contextString(context: Record<string, unknown> | null, key: string): string {
  const value = context?.[key]
  return typeof value === 'string' ? value : ''
}

function contextNumber(context: Record<string, unknown> | null, key: string): number | string {
  const value = context?.[key]
  return typeof value === 'number' ? value : ''
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenantScopeGuard = requireResolvedTenantScope(auth)
  if (tenantScopeGuard) return tenantScopeGuard

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })
  const rbac = container.resolve('rbacService') as RbacService
  const accessLogs = container.resolve('accessLogService') as AccessLogService
  const em = container.resolve('em') as EntityManager
  const canViewTenant = await rbac.userHasAllFeatures(
    auth.sub,
    ['audit_logs.view_tenant'],
    { tenantId: auth.tenantId ?? null, organizationId: defaultOrganizationId ?? null },
  )

  const url = new URL(req.url)
  const queryOrganizationId = url.searchParams.get('organizationId')
  let organizationId = defaultOrganizationId
  if (queryOrganizationId && (scope.allowedIds === null || scope.allowedIds.includes(queryOrganizationId))) {
    organizationId = queryOrganizationId
  }

  const actorQuery = url.searchParams.get('actorUserId')
  const actorUserId = canViewTenant && actorQuery ? actorQuery : auth.sub
  const limit = parseLimit(url.searchParams.get('limit'))
  const entries: Awaited<ReturnType<AccessLogService['list']>>['items'] = []
  try {
    let page = 1
    while (entries.length < limit) {
      const pageSize = Math.min(200, limit - entries.length)
      const result = await accessLogs.list({
        tenantId: auth.tenantId ?? undefined,
        organizationId: organizationId ?? undefined,
        actorUserId,
        resourceKind: url.searchParams.get('resourceKind') ?? undefined,
        resourceId: url.searchParams.get('resourceId') ?? undefined,
        accessType: url.searchParams.get('accessType') ?? undefined,
        page,
        pageSize,
        before: parseDate(url.searchParams.get('before')),
        after: parseDate(url.searchParams.get('after')),
      })
      entries.push(...result.items)
      if (result.items.length < pageSize || page >= result.totalPages) break
      page += 1
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    throw error
  }

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: entries.map((entry) => entry.actorUserId).filter((value): value is string => Boolean(value)),
    tenantIds: entries.map((entry) => entry.tenantId).filter((value): value is string => Boolean(value)),
    organizationIds: entries.map((entry) => entry.organizationId).filter((value): value is string => Boolean(value)),
  })
  const rows = entries.map((entry) => {
    const context = entry.contextJson
    return {
      when: entry.createdAt?.toISOString?.() ?? entry.createdAt,
      tenantId: entry.tenantId ?? '',
      tenant: entry.tenantId ? displayMaps.tenants[entry.tenantId] ?? entry.tenantId : '',
      organizationId: entry.organizationId ?? '',
      organization: entry.organizationId ? displayMaps.organizations[entry.organizationId] ?? entry.organizationId : '',
      actorUserId: entry.actorUserId ?? '',
      actor: entry.actorUserId ? displayMaps.users[entry.actorUserId] ?? entry.actorUserId : 'System',
      resourceKind: entry.resourceKind,
      resourceId: entry.resourceId,
      accessType: entry.accessType,
      operation: contextString(context, 'operation'),
      result: contextString(context, 'result'),
      statusCode: contextNumber(context, 'statusCode'),
      sourceIp: contextString(context, 'sourceIp'),
      userAgent: contextString(context, 'userAgent'),
      requestId: contextString(context, 'requestId'),
      sessionId: contextString(context, 'sessionId'),
      method: contextString(context, 'method'),
      path: contextString(context, 'path'),
      fields: entry.fieldsJson ?? [],
    }
  })

  const columns: PreparedExport['columns'] = [
    { field: 'when', header: 'When' },
    { field: 'tenantId', header: 'Tenant ID' },
    { field: 'tenant', header: 'Tenant' },
    { field: 'organizationId', header: 'Organization ID' },
    { field: 'organization', header: 'Organization' },
    { field: 'actorUserId', header: 'Actor User ID' },
    { field: 'actor', header: 'Actor' },
    { field: 'resourceKind', header: 'Resource Kind' },
    { field: 'resourceId', header: 'Resource ID' },
    { field: 'accessType', header: 'Access Type' },
    { field: 'operation', header: 'Operation' },
    { field: 'result', header: 'Result' },
    { field: 'statusCode', header: 'Status Code' },
    { field: 'sourceIp', header: 'Source IP' },
    { field: 'userAgent', header: 'User Agent' },
    { field: 'requestId', header: 'Request ID' },
    { field: 'sessionId', header: 'Session ID' },
    { field: 'method', header: 'Method' },
    { field: 'path', header: 'Path' },
    { field: 'fields', header: 'Fields' },
  ]
  const serialized = serializeExport({ columns, rows }, 'csv')
  const filename = defaultExportFilename('access-log-export', 'csv')
  return new Response(serialized.body, {
    headers: {
      'content-type': serialized.contentType,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Export access audit logs',
  description: 'Exports tenant-scoped access audit records as CSV.',
  methods: {
    GET: {
      summary: 'Export access logs as CSV',
      query: exportQuerySchema,
      responses: [{ status: 200, description: 'CSV export generated successfully', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid filter values', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
        { status: 403, description: 'Caller has no resolved tenant scope and is not a superadmin', schema: errorSchema },
      ],
    },
  },
}
