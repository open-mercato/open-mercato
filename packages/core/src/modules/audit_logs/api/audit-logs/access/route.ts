import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadAuditLogDisplayMaps } from '../display'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

const auditAccessQuerySchema = z.object({
  organizationId: z.string().uuid().describe('Limit results to a specific organization').optional(),
  actorUserId: z.string().uuid().describe('Filter by actor user id (tenant administrators only)').optional(),
  resourceKind: z.string().describe('Restrict to a resource kind such as `order` or `product`').optional(),
  accessType: z.string().describe('Access type filter, e.g. `read` or `export`').optional(),
  page: z.string().describe('Page number (default 1)').optional(),
  pageSize: z.string().describe('Page size (default 50)').optional(),
  limit: z.string().describe('Explicit maximum number of records when paginating manually').optional(),
  before: z.string().describe('Return logs created before this ISO-8601 timestamp').optional(),
  after: z.string().describe('Return logs created after this ISO-8601 timestamp').optional(),
})

const auditAccessItemSchema = z.object({
  id: z.string(),
  resourceKind: z.string(),
  resourceId: z.string(),
  accessType: z.string(),
  actorUserId: z.string().uuid().nullable(),
  actorUserName: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantName: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  fields: z.array(z.string()),
  context: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
})

const auditAccessResponseSchema = z.object({
  items: z.array(auditAccessItemSchema),
  canViewTenant: z.boolean(),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

const errorSchema = z.object({
  error: z.string(),
})

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) return undefined
  return new Date(ts)
}

function parseNumber(param: string | null, { min, max, fallback }: { min: number; max: number; fallback: number }) {
  if (!param) return fallback
  const value = Number(param)
  if (!Number.isFinite(value)) return fallback
  const normalized = Math.trunc(value)
  if (Number.isNaN(normalized)) return fallback
  return Math.min(Math.max(normalized, min), max)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const { organizationId: defaultOrganizationId, scope } = await resolveFeatureCheckContext({ container, auth, request: req })

  const rbac = (container.resolve('rbacService') as RbacService)
  const accessLogs = (container.resolve('accessLogService') as AccessLogService)
  const em = (container.resolve('em') as EntityManager)

  const canViewTenant = await rbac.userHasAllFeatures(
    auth.sub,
    ['audit_logs.view_tenant'],
    { tenantId: auth.tenantId ?? null, organizationId: defaultOrganizationId ?? null },
  )

  const url = new URL(req.url)
  const queryOrgId = url.searchParams.get('organizationId')
  const actorQuery = url.searchParams.get('actorUserId')
  const resourceKind = url.searchParams.get('resourceKind')
  const accessType = url.searchParams.get('accessType')
  const page = parseNumber(url.searchParams.get('page'), { min: 1, max: 1000000, fallback: 1 })
  const pageSize = parseNumber(url.searchParams.get('pageSize'), { min: 1, max: 200, fallback: 50 })
  const before = parseDate(url.searchParams.get('before'))
  const after = parseDate(url.searchParams.get('after'))

  let organizationId = defaultOrganizationId
  if (queryOrgId) {
    if (scope.allowedIds === null || scope.allowedIds.includes(queryOrgId)) {
      organizationId = queryOrgId
    }
  }

  let actorUserId = auth.sub
  if (canViewTenant && actorQuery) {
    actorUserId = actorQuery
  }

  const list = await accessLogs.list({
    tenantId: auth.tenantId ?? undefined,
    organizationId: organizationId ?? undefined,
    actorUserId,
    resourceKind: resourceKind ?? undefined,
    accessType: accessType ?? undefined,
    page,
    pageSize,
    limit: url.searchParams.get('limit') ? parseNumber(url.searchParams.get('limit'), { min: 1, max: 200, fallback: pageSize }) : undefined,
    before,
    after,
  })

  const displayMaps = await loadAuditLogDisplayMaps(em, {
    userIds: list.items.map((entry) => entry.actorUserId).filter((value): value is string => !!value),
    tenantIds: list.items.map((entry) => entry.tenantId).filter((value): value is string => !!value),
    organizationIds: list.items.map((entry) => entry.organizationId).filter((value): value is string => !!value),
  })

  const items = list.items.map((entry) => ({
    id: entry.id,
    resourceKind: entry.resourceKind,
    resourceId: entry.resourceId,
    accessType: entry.accessType,
    actorUserId: entry.actorUserId,
    actorUserName: entry.actorUserId ? displayMaps.users[entry.actorUserId] ?? null : null,
    tenantId: entry.tenantId,
    tenantName: entry.tenantId ? displayMaps.tenants[entry.tenantId] ?? null : null,
    organizationId: entry.organizationId,
    organizationName: entry.organizationId ? displayMaps.organizations[entry.organizationId] ?? null : null,
    fields: entry.fieldsJson ?? [],
    context: entry.contextJson,
    createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
  }))

  return NextResponse.json({
    items,
    canViewTenant,
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages,
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List access audit logs',
  description: 'Retrieve read-only audit log entries detailing resource access within the current tenant or organization.',
  methods: {
    GET: {
      summary: 'Retrieve access logs',
      description:
        'Fetches paginated access audit logs scoped to the authenticated user. Tenant administrators can optionally expand the search to other actors or organizations.',
      query: auditAccessQuerySchema,
      responses: [
        { status: 200, description: 'Access logs returned successfully', schema: auditAccessResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid filters supplied', schema: errorSchema },
        { status: 401, description: 'Authentication required', schema: errorSchema },
      ],
    },
  },
}
