import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { IncidentSettings } from '../../data/entities'
import { settingsUpdateSchema } from '../../data/validators'
import {
  createIncidentsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
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
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: IncidentSettings,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.incidents.incident_settings },
  list: {
    schema: listSchema,
    entityId: E.incidents.incident_settings,
    fields: [
      'id',
      'number_format',
      'ack_timeout_minutes',
      'escalation_timeout_minutes',
      'escalation_chain',
      'sla_targets',
      'auto_incident_triggers',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'incidents.settings.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(settingsUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({
        id: readStringField(result, 'id'),
        ok: true,
        updatedAt: readUpdatedAt(result),
      }),
      status: 200,
    },
    update: {
      commandId: 'incidents.settings.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(settingsUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result?: unknown }) => ({
        ok: true,
        updatedAt: readUpdatedAt(result),
      }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT

const settingsItemSchema = z.object({
  id: z.string().uuid(),
  number_format: z.string().nullable().optional(),
  ack_timeout_minutes: z.number().nullable().optional(),
  escalation_timeout_minutes: z.number().nullable().optional(),
  escalation_chain: z.unknown().nullable().optional(),
  sla_targets: z.unknown().nullable().optional(),
  auto_incident_triggers: z.unknown().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const settingsUpsertResponseSchema = defaultOkResponseSchema.extend({
  id: z.string().uuid().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createIncidentsCrudOpenApi({
  resourceName: 'Incident settings',
  pluralName: 'Incident settings',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(settingsItemSchema),
  create: {
    schema: settingsUpdateSchema,
    responseSchema: settingsUpsertResponseSchema,
    status: 200,
    description: 'Upserts the single incident settings row for the authenticated organization scope.',
  },
  update: {
    schema: settingsUpdateSchema,
    responseSchema: settingsUpsertResponseSchema,
    description: 'Updates the single incident settings row for the authenticated organization scope.',
  },
})
