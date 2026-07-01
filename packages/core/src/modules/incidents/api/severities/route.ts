import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { IncidentSeverity } from '../../data/entities'
import { severityCreateSchema, severityUpdateSchema } from '../../data/validators'
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
    key: z.string().optional(),
    isActive: z.string().optional(),
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
      { key: { $ilike: term } },
      { label: { $ilike: term } },
    ]
  }
  if (query.key?.trim()) filters.key = { $eq: query.key.trim() }
  const isActive = parseBooleanToken(query.isActive)
  if (isActive !== null) filters.is_active = { $eq: isActive }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: IncidentSeverity,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.incidents.incident_severity },
  list: {
    schema: listSchema,
    entityId: E.incidents.incident_severity,
    fields: [
      'id',
      'key',
      'label',
      'rank',
      'color_token',
      'is_default',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      key: 'key',
      label: 'label',
      rank: 'rank',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'incidents.incident_severities.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(severityCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({ id: readStringField(result, 'id') }),
      status: 201,
    },
    update: {
      commandId: 'incidents.incident_severities.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(severityUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({ ok: true, updatedAt: readUpdatedAt(result) }),
    },
    delete: {
      commandId: 'incidents.incident_severities.delete',
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

const severityItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  rank: z.number().nullable().optional(),
  color_token: z.string().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const createResponseSchema = z.object({ id: z.string().uuid().nullable() })
const okWithUpdatedAtSchema = defaultOkResponseSchema.extend({ updatedAt: z.string().nullable().optional() })

export const openApi = createIncidentsCrudOpenApi({
  resourceName: 'Incident severity',
  pluralName: 'Incident severities',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(severityItemSchema),
  create: { schema: severityCreateSchema, responseSchema: createResponseSchema },
  update: { schema: severityUpdateSchema, responseSchema: okWithUpdatedAtSchema },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an incident severity by id. Request body or query may provide the identifier.',
  },
})
