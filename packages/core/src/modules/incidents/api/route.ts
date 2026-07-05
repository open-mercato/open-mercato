import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { Incident } from '../data/entities'
import { incidentCreateSchema, incidentUpdateSchema } from '../data/validators'
import {
  createIncidentsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from './openapi'

const rawBodySchema = z.object({}).passthrough()

const scopedDeleteSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
})

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.string().optional(),
    severityId: z.string().uuid().optional(),
    ownerUserId: z.string().uuid().optional(),
    owningTeamId: z.string().uuid().optional(),
    incidentTypeId: z.string().uuid().optional(),
    active: z.string().optional(),
    excludeDrills: z.string().optional(),
    escalationStatus: z.string().optional(),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type IncidentListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.incident.view'] },
  POST: { requireAuth: true, requireFeatures: ['incidents.incident.create'] },
  PUT: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['incidents.incident.manage'] },
}

export const metadata = routeMetadata

const listFields = [
  'id',
  'number',
  'title',
  'status',
  'severity_id',
  'priority',
  'owner_user_id',
  'owning_team_id',
  'escalation_status',
  'escalation_level',
  'revenue_at_risk_minor',
  'revenue_at_risk_currency',
  'sla_at_risk',
  'sla_breached',
  'created_at',
  'updated_at',
] as const

const detailFields = [
  ...listFields,
  'description',
  'incident_type_id',
  'visibility',
  'is_drill',
  'is_major',
  'reporter_user_id',
  'detected_at',
  'acknowledged_at',
  'started_at',
  'resolved_at',
  'closed_at',
  'escalation_level',
  'next_escalation_at',
  'snoozed_until',
  'escalation_policy_id',
  'escalation_status',
  'escalation_repeats_done',
  'escalation_last_targets',
  'sla_response_due_at',
  'sla_resolution_due_at',
  'next_update_due_at',
  'update_overdue_notified_at',
  'merged_into_incident_id',
  'source_event_ref',
  'customer_impact_summary',
  'organization_id',
  'tenant_id',
] as const

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => z.string().uuid().safeParse(value).success)
}

function readUpdatedAt(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const raw = (result as Record<string, unknown>).updatedAt
  if (raw instanceof Date) return raw.toISOString()
  return typeof raw === 'string' ? raw : null
}

function buildFilters(query: IncidentListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) {
    filters.id = { $eq: query.id }
  } else {
    const ids = parseUuidList(query.ids)
    if (ids.length > 0) filters.id = { $in: ids }
  }
  if (query.search?.trim()) {
    const term = buildIlikeTerm(query.search)
    filters.$or = [
      { number: { $ilike: term } },
      { title: { $ilike: term } },
    ]
  }
  if (query.status?.trim()) filters.status = { $eq: query.status.trim() }
  if (query.severityId) filters.severity_id = { $eq: query.severityId }
  if (query.ownerUserId) filters.owner_user_id = { $eq: query.ownerUserId }
  if (query.owningTeamId) filters.owning_team_id = { $eq: query.owningTeamId }
  if (query.incidentTypeId) filters.incident_type_id = { $eq: query.incidentTypeId }
  const active = parseBooleanToken(query.active)
  if (active === true) filters.status = { $nin: ['resolved', 'closed'] }
  if (active === false) filters.status = { $in: ['resolved', 'closed'] }
  if (parseBooleanToken(query.excludeDrills) === true) filters.is_drill = { $eq: false }
  const escalationStatus = query.escalationStatus?.trim()
  if (escalationStatus === 'escalated') filters.escalation_status = { $in: ['active', 'exhausted'] }
  else if (escalationStatus) filters.escalation_status = { $eq: escalationStatus }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Incident,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.incidents.incident },
  list: {
    schema: listSchema,
    entityId: E.incidents.incident,
    fields: (query: IncidentListQuery) => (query.id ? [...detailFields] : [...listFields]),
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      number: 'number',
      title: 'title',
      status: 'status',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'incidents.incident.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(incidentCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => {
        const id = result && typeof result === 'object'
          ? (result as Record<string, unknown>).incidentId
          : null
        return { id: typeof id === 'string' ? id : null }
      },
      status: 201,
    },
    update: {
      commandId: 'incidents.incident.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(incidentUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({ ok: true, updatedAt: readUpdatedAt(result) }),
    },
    delete: {
      commandId: 'incidents.incident.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('incidents.errors.id_required', 'Incident id is required') })
        return parseScopedCommandInput(scopedDeleteSchema, { id }, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const incidentListItemSchema = z.object({
  id: z.string().uuid(),
  number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  severity_id: z.string().uuid().nullable().optional(),
  incident_type_id: z.string().uuid().nullable().optional(),
  priority: z.string().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  owning_team_id: z.string().uuid().nullable().optional(),
  reporter_user_id: z.string().uuid().nullable().optional(),
  visibility: z.string().nullable().optional(),
  is_drill: z.boolean().nullable().optional(),
  is_major: z.boolean().nullable().optional(),
  detected_at: z.string().nullable().optional(),
  acknowledged_at: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  escalation_level: z.number().nullable().optional(),
  next_escalation_at: z.string().nullable().optional(),
  snoozed_until: z.string().nullable().optional(),
  escalation_policy_id: z.string().uuid().nullable().optional(),
  escalation_status: z.string().nullable().optional(),
  escalation_repeats_done: z.number().nullable().optional(),
  escalation_last_targets: z.object({
    targets: z.array(z.object({
      type: z.string(),
      id: z.string(),
      label: z.string().optional(),
    })).optional(),
    recipients: z.array(z.object({
      userId: z.string(),
      label: z.string().optional(),
    })).optional(),
    resolvedAt: z.string().optional(),
  }).passthrough().nullable().optional(),
  sla_response_due_at: z.string().nullable().optional(),
  sla_resolution_due_at: z.string().nullable().optional(),
  next_update_due_at: z.string().nullable().optional(),
  update_overdue_notified_at: z.string().nullable().optional(),
  sla_at_risk: z.boolean().nullable().optional(),
  sla_breached: z.boolean().nullable().optional(),
  merged_into_incident_id: z.string().uuid().nullable().optional(),
  source_event_ref: z.string().nullable().optional(),
  customer_impact_summary: z.string().nullable().optional(),
  revenue_at_risk_minor: z.string().nullable().optional(),
  revenue_at_risk_currency: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const incidentCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

const okWithUpdatedAtSchema = defaultOkResponseSchema.extend({
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createIncidentsCrudOpenApi({
  resourceName: 'Incident',
  pluralName: 'Incidents',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(incidentListItemSchema),
  create: {
    schema: incidentCreateSchema,
    responseSchema: incidentCreateResponseSchema,
    description: 'Creates an incident and allocates its incident number in the authenticated organization scope.',
  },
  update: {
    schema: incidentUpdateSchema,
    responseSchema: okWithUpdatedAtSchema,
    description: 'Updates an incident by id. The optimistic-lock header is enforced by the CRUD mutation guard flow.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an incident by id. Request body or query may provide the identifier.',
  },
})
