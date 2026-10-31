import { incidentFind } from '../../lib/read'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleRoute } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  getCustomerAuthFromRequest,
  requireCustomerFeature,
} from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import {
  Incident,
  IncidentImpact,
  IncidentSeverity,
  IncidentTimelineEntry,
} from '../../data/entities'

const PORTAL_INCIDENTS_FEATURE = 'portal.incidents.view'
const MAX_PAGE_SIZE = 50
const CUSTOMER_TARGET_TYPES = ['customer_account', 'customer_person', 'customer_company'] as const

type PortalApiMetadata = Pick<ModuleRoute, 'requireAuth' | 'requireCustomerAuth' | 'requireCustomerFeatures'>

export const metadata: PortalApiMetadata = {
  requireAuth: false,
  requireCustomerAuth: true,
  requireCustomerFeatures: [PORTAL_INCIDENTS_FEATURE],
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
})

const severitySchema = z.object({
  key: z.string(),
  label: z.string(),
  colorToken: z.string(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  body: z.string().nullable(),
  createdAt: z.string().datetime(),
})

const incidentSchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  title: z.string(),
  status: z.string(),
  severity: severitySchema.nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  updates: z.array(updateSchema),
})

const responseSchema = z.object({
  items: z.array(incidentSchema),
  total: z.number().int().min(0),
})

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

type CustomerTargetType = typeof CUSTOMER_TARGET_TYPES[number]

type CustomerTarget = {
  targetType: CustomerTargetType
  targetId: string
}

type PortalIncidentItem = z.infer<typeof incidentSchema>

function readQuery(req: Request): Record<string, string | undefined> {
  const url = new URL(req.url)
  return {
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  }
}

function uniqueTargets(targets: CustomerTarget[]): CustomerTarget[] {
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.targetType}:${target.targetId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveCustomerTargets(auth: {
  customerEntityId?: string | null
  personEntityId?: string | null
}): CustomerTarget[] {
  return uniqueTargets([
    ...(auth.personEntityId ? [{ targetType: 'customer_person' as const, targetId: auth.personEntityId }] : []),
    ...(auth.customerEntityId
      ? [
          { targetType: 'customer_company' as const, targetId: auth.customerEntityId },
          { targetType: 'customer_account' as const, targetId: auth.customerEntityId },
        ]
      : []),
  ])
}

function serializeUpdate(entry: IncidentTimelineEntry): z.infer<typeof updateSchema> {
  return {
    id: entry.id,
    body: entry.body ?? null,
    createdAt: entry.createdAt.toISOString(),
  }
}

function groupUpdates(entries: IncidentTimelineEntry[]): Map<string, z.infer<typeof updateSchema>[]> {
  const byIncident = new Map<string, z.infer<typeof updateSchema>[]>()
  for (const entry of entries) {
    const bucket = byIncident.get(entry.incidentId) ?? []
    if (bucket.length < 20) {
      bucket.push(serializeUpdate(entry))
      byIncident.set(entry.incidentId, bucket)
    }
  }
  return byIncident
}

async function portalError(key: string, status: number) {
  const { translate } = await resolveTranslations()
  return NextResponse.json({ ok: false, error: translate(key) }, { status })
}

async function loadCustomerIncidentIds(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
  targets: CustomerTarget[],
): Promise<string[]> {
  if (targets.length === 0) return []

  const targetIds = Array.from(new Set(targets.map((target) => target.targetId)))
  const impacts = await incidentFind(em,
    IncidentImpact,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      targetType: { $in: [...CUSTOMER_TARGET_TYPES] },
      targetId: { $in: targetIds },
    },
    { fields: ['incidentId'] },
  )

  return Array.from(new Set(impacts.map((impact) => impact.incidentId)))
}

async function loadSeverities(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
  incidents: Incident[],
): Promise<Map<string, IncidentSeverity>> {
  const severityIds = Array.from(new Set(incidents.map((incident) => incident.severityId).filter(Boolean)))
  if (severityIds.length === 0) return new Map()

  const severities = await incidentFind(em,
    IncidentSeverity,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      id: { $in: severityIds },
      deletedAt: null,
    },
  )

  return new Map(severities.map((severity) => [severity.id, severity]))
}

async function loadCustomerUpdates(
  em: EntityManager,
  scope: { organizationId: string; tenantId: string },
  incidentIds: string[],
): Promise<Map<string, z.infer<typeof updateSchema>[]>> {
  if (incidentIds.length === 0) return new Map()

  const entries = await incidentFind(
    em,
    IncidentTimelineEntry,
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      incidentId: { $in: incidentIds },
      visibility: 'customer_facing',
    },
    {
      orderBy: { createdAt: 'desc' },
    },
    scope,
  )

  return groupUpdates(entries)
}

function serializeIncident(
  incident: Incident,
  severityById: Map<string, IncidentSeverity>,
  updatesByIncidentId: Map<string, z.infer<typeof updateSchema>[]>,
): PortalIncidentItem {
  const severity = severityById.get(incident.severityId) ?? null
  return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    status: incident.status,
    severity: severity
      ? {
          key: severity.key,
          label: severity.label,
          colorToken: severity.colorToken,
        }
      : null,
    createdAt: incident.createdAt.toISOString(),
    resolvedAt: incident.resolvedAt instanceof Date ? incident.resolvedAt.toISOString() : null,
    updates: updatesByIncidentId.get(incident.id) ?? [],
  }
}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return portalError('incidents.portal.error.authRequired', 401)
  }

  const parsedQuery = querySchema.safeParse(readQuery(req))
  if (!parsedQuery.success) {
    return portalError('incidents.portal.error.invalidQuery', 400)
  }

  const container = await createRequestContainer()
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  try {
    await requireCustomerFeature(auth, [PORTAL_INCIDENTS_FEATURE], customerRbacService)
  } catch (response) {
    return response as NextResponse
  }

  const em = (container.resolve('em') as EntityManager).fork()
  const scope = { organizationId: auth.orgId, tenantId: auth.tenantId }
  const targets = resolveCustomerTargets(auth)
  const incidentIds = await loadCustomerIncidentIds(em, scope, targets)

  if (incidentIds.length === 0) {
    return NextResponse.json({ items: [], total: 0 })
  }

  const { page, pageSize } = parsedQuery.data
  const incidentWhere = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
    id: { $in: incidentIds },
  }
  const [incidents, total] = await Promise.all([
    incidentFind(
      em,
      Incident,
      incidentWhere,
      {
        orderBy: { createdAt: 'desc' },
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
      scope,
    ),
    em.count(Incident, incidentWhere),
  ])

  const pageIncidentIds = incidents.map((incident) => incident.id)
  const [severityById, updatesByIncidentId] = await Promise.all([
    loadSeverities(em, scope, incidents),
    loadCustomerUpdates(em, scope, pageIncidentIds),
  ])

  return NextResponse.json({
    items: incidents.map((incident) => serializeIncident(incident, severityById, updatesByIncidentId)),
    total,
  })
}

const methodDoc: OpenApiMethodDoc = {
  summary: 'List portal incidents',
  description:
    'Lists incidents affecting the authenticated customer account, person, or company. Returns only customer-safe fields and customer-facing timeline updates.',
  tags: ['Incidents', 'Customer Portal'],
  query: querySchema,
  responses: [{ status: 200, description: 'Portal incident list', schema: responseSchema }],
  errors: [
    { status: 400, description: 'Invalid query parameters', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Portal incidents',
  methods: { GET: methodDoc },
}
