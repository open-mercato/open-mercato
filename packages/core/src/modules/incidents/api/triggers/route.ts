import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { IncidentTrigger } from '../../data/entities'
import { triggerCreateSchema, triggerUpdateSchema, triggerConditionSchema } from '../../data/validators'
import {
  createIncidentsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

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
    eventId: z.string().optional(),
    isEnabled: z.string().optional(),
    severityKey: z.string().optional(),
    typeKey: z.string().optional(),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type ListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['incidents.settings.manage'] },
  POST: { requireAuth: true, requireFeatures: ['incidents.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['incidents.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['incidents.settings.manage'] },
}

export const metadata = routeMetadata

const INCIDENT_TRIGGER_ENTITY_ID = 'incidents:incident_trigger'

function parseUuidList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => z.string().uuid().safeParse(value).success)
}

function readStringField(result: unknown, field: string): string | null {
  if (!result || typeof result !== 'object') return null
  const value = (result as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}

function readUpdatedAt(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const raw = (result as Record<string, unknown>).updatedAt
  if (raw instanceof Date) return raw.toISOString()
  return typeof raw === 'string' ? raw : null
}

function buildFilters(query: ListQuery): Record<string, unknown> {
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
      { event_id: { $ilike: term } },
      { severity_key: { $ilike: term } },
      { type_key: { $ilike: term } },
    ]
  }
  if (query.eventId?.trim()) filters.event_id = { $eq: query.eventId.trim() }
  if (query.severityKey?.trim()) filters.severity_key = { $eq: query.severityKey.trim() }
  if (query.typeKey?.trim()) filters.type_key = { $eq: query.typeKey.trim() }
  const isEnabled = parseBooleanToken(query.isEnabled)
  if (isEnabled !== null) filters.is_enabled = { $eq: isEnabled }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: IncidentTrigger,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: INCIDENT_TRIGGER_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: INCIDENT_TRIGGER_ENTITY_ID,
    fields: [
      'id',
      'event_id',
      'is_enabled',
      'severity_key',
      'type_key',
      'escalation_policy_id',
      'conditions',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      eventId: 'event_id',
      severityKey: 'severity_key',
      typeKey: 'type_key',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'incidents.incident_triggers.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(triggerCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({ id: readStringField(result, 'id') }),
      status: 201,
    },
    update: {
      commandId: 'incidents.incident_triggers.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(triggerUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({ ok: true, updatedAt: readUpdatedAt(result) }),
    },
    delete: {
      commandId: 'incidents.incident_triggers.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('incidents.errors.id_required', 'Record id is required') })
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

const triggerItemSchema = z.object({
  id: z.string().uuid(),
  event_id: z.string().nullable().optional(),
  is_enabled: z.boolean().nullable().optional(),
  severity_key: z.string().nullable().optional(),
  type_key: z.string().nullable().optional(),
  escalation_policy_id: z.string().uuid().nullable().optional(),
  conditions: z.array(triggerConditionSchema).nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const createResponseSchema = z.object({ id: z.string().uuid().nullable() })
const okWithUpdatedAtSchema = defaultOkResponseSchema.extend({ updatedAt: z.string().nullable().optional() })

export const openApi = createIncidentsCrudOpenApi({
  resourceName: 'Incident trigger',
  pluralName: 'Incident triggers',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(triggerItemSchema),
  create: { schema: triggerCreateSchema, responseSchema: createResponseSchema },
  update: { schema: triggerUpdateSchema, responseSchema: okWithUpdatedAtSchema },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an incident trigger by id. Request body or query may provide the identifier.',
  },
})
