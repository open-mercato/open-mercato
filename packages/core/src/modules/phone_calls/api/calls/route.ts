import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { Where } from '@open-mercato/shared/lib/query/types'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import { PhoneCall } from '../../data/entities'
import { createPhoneCallsCrudOpenApi, createPagedListResponseSchema } from '../openapi'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    providerKey: z.string().optional(),
    status: z.string().optional(),
    direction: z.string().optional(),
    startedFrom: z.string().optional(),
    startedTo: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    id: z.string().uuid().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['phone_calls.view'] },
}

export const metadata = routeMetadata

// No `recording_url`: provider recording links carry their own access token, and this route
// is gated on `phone_calls.view`. The key still ships as null so the response shape holds.
const listFields = [
  'id',
  'organization_id',
  'tenant_id',
  'provider_key',
  'integration_id',
  'external_call_id',
  'external_conversation_id',
  'direction',
  'status',
  'started_at',
  'answered_at',
  'ended_at',
  'duration_seconds',
  'ingest_status',
  'last_ingested_at',
  'created_at',
  'updated_at',
]

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: PhoneCall,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.phone_calls.phone_call },
  list: {
    schema: listSchema,
    entityId: E.phone_calls.phone_call,
    fields: listFields,
    transformItem: (item: Record<string, unknown>) => ({ ...item, recording_url: null }),
    sortFieldMap: {
      externalCallId: 'external_call_id',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      durationSeconds: 'duration_seconds',
      status: 'status',
      direction: 'direction',
      providerKey: 'provider_key',
      ingestStatus: 'ingest_status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query): Where<Record<string, unknown>> => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.providerKey) filters.provider_key = { $eq: query.providerKey }
      if (query.status) filters.status = { $eq: query.status }
      if (query.direction) filters.direction = { $eq: query.direction }
      if (query.q) {
        const term = buildIlikeTerm(query.q)
        filters.$or = [
          { external_call_id: { $ilike: term } },
          { external_conversation_id: { $ilike: term } },
          { provider_key: { $ilike: term } },
        ]
      }
      const startedRange: Record<string, Date> = {}
      if (query.startedFrom) {
        const from = new Date(query.startedFrom)
        if (!Number.isNaN(from.getTime())) startedRange.$gte = from
      }
      if (query.startedTo) {
        const to = new Date(query.startedTo)
        if (!Number.isNaN(to.getTime())) startedRange.$lte = to
      }
      if (Object.keys(startedRange).length) filters.started_at = startedRange
      return filters
    },
  },
})

export const GET = crud.GET

const phoneCallListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  provider_key: z.string().nullable().optional(),
  integration_id: z.string().nullable().optional(),
  external_call_id: z.string().nullable().optional(),
  external_conversation_id: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  answered_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  recording_url: z.string().nullable().optional(),
  ingest_status: z.string().nullable().optional(),
  last_ingested_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createPhoneCallsCrudOpenApi({
  resourceName: 'PhoneCall',
  pluralName: 'PhoneCalls',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(phoneCallListItemSchema),
})
