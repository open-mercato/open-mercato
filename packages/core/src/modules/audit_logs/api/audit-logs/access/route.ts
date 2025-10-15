import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveFeatureCheckContext } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadAuditLogDisplayMaps } from '../display'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['audit_logs.view_self'] },
}

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

  const rbac = container.resolve<RbacService>('rbacService')
  const accessLogs = container.resolve<AccessLogService>('accessLogService')
  const em = container.resolve<EntityManager>('em')

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

  await logCrudAccess({
    container,
    auth,
    request: req,
    items,
    idField: 'id',
    resourceKind: 'audit_logs.access',
    organizationId,
    tenantId: auth.tenantId ?? null,
    query: Object.fromEntries(url.searchParams.entries()),
  })

  return NextResponse.json({
    items,
    canViewTenant,
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    totalPages: list.totalPages,
  })
}
