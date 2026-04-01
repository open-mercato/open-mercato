import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerDeal, CustomerInteraction } from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { interactionCreateSchema, interactionUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput } from '../utils'
import {
  createCustomersCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'
import { CUSTOMER_INTERACTION_ENTITY_ID } from '../../lib/interactionCompatibility'

const rawBodySchema = z.object({}).passthrough()

const interactionSortFieldSchema = z.enum([
  'scheduledAt',
  'occurredAt',
  'createdAt',
  'updatedAt',
  'status',
  'priority',
  'interactionType',
])

const listSchema = z
  .object({
    limit: z.coerce.number().min(1).max(100).default(25),
    cursor: z.string().optional(),
    entityId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    status: z.string().optional(),
    interactionType: z.string().optional(),
    excludeInteractionType: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    sortField: interactionSortFieldSchema.optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.interactions.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.interactions.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerInteraction,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  enrichers: { entityId: 'customers.interaction' },
  indexer: {
    entityType: 'customers:customer_interaction',
  },
  actions: {
    create: {
      commandId: 'customers.interactions.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(interactionCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.interactionId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.interactions.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(interactionUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.interactions.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('customers.errors.interaction_required', 'Interaction id is required'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }

type InteractionListRow = {
  id: string
  entity_id: string
  deal_id: string | null
  interaction_type: string
  title: string | null
  body: string | null
  status: string
  scheduled_at: Date | null
  occurred_at: Date | null
  priority: number | null
  author_user_id: string | null
  owner_user_id: string | null
  appearance_icon: string | null
  appearance_color: string | null
  source: string | null
  organization_id: string
  tenant_id: string
  created_at: Date
  updated_at: Date
  __sort_value: string | number | Date | null
}

type CursorPayload = {
  id: string
  sortValue: string | number | null
}

type RbacServiceLike = {
  getGrantedFeatures?: (userId: string, input: { tenantId: string | null; organizationId: string | null }) => Promise<string[]>
}

const cursorSchema = z.object({
  id: z.string().uuid(),
  sortValue: z.union([z.string(), z.number(), z.null()]),
})

const interactionSortConfig = {
  scheduledAt: { column: 'scheduled_at', type: 'date' as const, defaultDir: 'asc' as const },
  occurredAt: { column: 'occurred_at', type: 'date' as const, defaultDir: 'desc' as const },
  createdAt: { column: 'created_at', type: 'date' as const, defaultDir: 'desc' as const },
  updatedAt: { column: 'updated_at', type: 'date' as const, defaultDir: 'desc' as const },
  status: { column: 'status', type: 'text' as const, defaultDir: 'asc' as const },
  priority: { column: 'priority', type: 'number' as const, defaultDir: 'desc' as const },
  interactionType: { column: 'interaction_type', type: 'text' as const, defaultDir: 'asc' as const },
} as const

function toIsoString(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString()
  }
  return null
}

function normalizeCursorValue(
  value: string | number | Date | null,
  type: 'date' | 'number' | 'text',
): string | number | null {
  if (value == null) return null
  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isNaN(parsed) ? null : parsed
    }
    return null
  }
  if (type === 'date') {
    return toIsoString(value)
  }
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decodeCursor(token: string | undefined, type: 'date' | 'number' | 'text'): CursorPayload | null {
  if (!token) return null
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8')
    const parsed = cursorSchema.parse(JSON.parse(decoded))
    return {
      id: parsed.id,
      sortValue: normalizeCursorValue(parsed.sortValue, type),
    }
  } catch {
    return null
  }
}

function buildSortSql(
  sortField: keyof typeof interactionSortConfig,
  sortDir: 'asc' | 'desc',
): string {
  const config = interactionSortConfig[sortField]
  if (config.type === 'date') {
    const sentinel =
      sortDir === 'asc'
        ? "timestamp with time zone '9999-12-31T23:59:59.999Z'"
        : "timestamp with time zone '0001-01-01T00:00:00.000Z'"
    return `coalesce(${config.column}, ${sentinel})`
  }
  if (config.type === 'number') {
    const sentinel = sortDir === 'asc' ? '2147483647' : '-2147483648'
    return `coalesce(${config.column}, ${sentinel})`
  }
  const sentinel = sortDir === 'asc' ? "'~~~~~~~~~~'" : "''"
  return `coalesce(${config.column}, ${sentinel})`
}

async function resolveUserFeatures(
  container: { resolve: (name: string) => unknown },
  userId: string,
  tenantId: string | null,
  organizationId: string | null,
): Promise<string[] | undefined> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return undefined
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return undefined
  }
}

async function buildEnricherContext(
  container: { resolve: (name: string) => unknown },
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>,
  organizationId: string | null,
): Promise<EnricherContext> {
  const userId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0
      ? auth.sub
      : typeof auth.userId === 'string' && auth.userId.trim().length > 0
        ? auth.userId
        : typeof auth.keyId === 'string' && auth.keyId.trim().length > 0
          ? auth.keyId
          : 'system')

  return {
    organizationId: organizationId ?? '',
    tenantId: auth.tenantId ?? '',
    userId,
    em: container.resolve('em'),
    container,
    userFeatures: await resolveUserFeatures(container, userId, auth.tenantId ?? null, organizationId),
  }
}

export async function GET(req: Request) {
  try {
    const queryUrl = new URL(req.url)
    const query = listSchema.parse(Object.fromEntries(queryUrl.searchParams))
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, {
        error: translate('customers.errors.unauthorized', 'Unauthorized'),
      })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
      ? scope.filterIds
      : auth.orgId
        ? [auth.orgId]
        : []
    const selectedOrganizationId = scope?.selectedId ?? auth.orgId ?? organizationIds[0] ?? null
    const em = (container.resolve('em') as EntityManager).fork()
    const knex = em.getKnex()

    const requestedSortField = query.sortField ?? 'scheduledAt'
    const sortConfig = interactionSortConfig[requestedSortField]
    const sortDir = query.sortDir ?? sortConfig.defaultDir
    const sortSql = buildSortSql(requestedSortField, sortDir)
    const cursor = decodeCursor(query.cursor, sortConfig.type)
    if (query.cursor && !cursor) {
      throw new CrudHttpError(400, {
        error: translate('customers.interactions.cursor.invalid', 'Invalid cursor'),
      })
    }

    const rowsQuery = knex('customer_interactions')
      .select<InteractionListRow[]>([
        'id',
        'entity_id',
        'deal_id',
        'interaction_type',
        'title',
        'body',
        'status',
        'scheduled_at',
        'occurred_at',
        'priority',
        'author_user_id',
        'owner_user_id',
        'appearance_icon',
        'appearance_color',
        'source',
        'organization_id',
        'tenant_id',
        'created_at',
        'updated_at',
        knex.raw(`${sortSql} as __sort_value`),
      ])
      .whereNull('deleted_at')
      .andWhere('tenant_id', auth.tenantId)
      .limit(query.limit + 1)

    if (organizationIds.length > 0) {
      rowsQuery.whereIn('organization_id', organizationIds)
    }
    if (query.entityId) {
      rowsQuery.andWhere('entity_id', query.entityId)
    }
    if (query.dealId) {
      rowsQuery.andWhere('deal_id', query.dealId)
    }
    if (query.status) {
      rowsQuery.andWhere('status', query.status)
    }
    if (query.interactionType) {
      rowsQuery.andWhere('interaction_type', query.interactionType)
    }
    if (query.excludeInteractionType) {
      rowsQuery.andWhereNot('interaction_type', query.excludeInteractionType)
    }
    if (query.from) {
      rowsQuery.andWhere('scheduled_at', '>=', new Date(query.from))
    }
    if (query.to) {
      rowsQuery.andWhere('scheduled_at', '<=', new Date(query.to))
    }
    if (cursor) {
      const op = sortDir === 'asc' ? '>' : '<'
      rowsQuery.andWhere(function applyCursor() {
        this.whereRaw(`${sortSql} ${op} ?`, [cursor.sortValue]).orWhere(function applyTieBreaker() {
          this.whereRaw(`${sortSql} = ?`, [cursor.sortValue]).andWhere('id', op, cursor.id)
        })
      })
    }

    rowsQuery.orderByRaw(`${sortSql} ${sortDir}`)
    rowsQuery.orderBy('id', sortDir)

    const rows = await rowsQuery
    const pageRows = rows.slice(0, query.limit)
    const hasMore = rows.length > query.limit

    const authorIds = Array.from(
      new Set(
        pageRows
          .map((row) => (typeof row.author_user_id === 'string' ? row.author_user_id : null))
          .filter((value): value is string => !!value),
      ),
    )
    const dealIds = Array.from(
      new Set(
        pageRows
          .map((row) => (typeof row.deal_id === 'string' ? row.deal_id : null))
          .filter((value): value is string => !!value),
      ),
    )
    const interactionIds = pageRows.map((row) => row.id)

    const [users, deals, customFieldValues] = await Promise.all([
      authorIds.length > 0 ? findWithDecryption(em, User, { id: { $in: authorIds } }, undefined, { tenantId: auth.tenantId, organizationId: selectedOrganizationId }) : Promise.resolve([]),
      dealIds.length > 0 ? findWithDecryption(em, CustomerDeal, { id: { $in: dealIds } }, undefined, { tenantId: auth.tenantId, organizationId: selectedOrganizationId }) : Promise.resolve([]),
      interactionIds.length > 0
        ? loadCustomFieldValues({
            em,
            entityId: CUSTOMER_INTERACTION_ENTITY_ID,
            recordIds: interactionIds,
            tenantIdByRecord: Object.fromEntries(pageRows.map((row) => [row.id, row.tenant_id])),
            organizationIdByRecord: Object.fromEntries(pageRows.map((row) => [row.id, row.organization_id])),
            tenantFallbacks: [auth.tenantId].filter((value): value is string => !!value),
          })
        : Promise.resolve<Record<string, Record<string, unknown>>>({}),
    ])

    const userMap = new Map(
      users.map((user) => [
        user.id,
        {
          name: user.name ?? null,
          email: user.email ?? null,
        },
      ]),
    )
    const dealMap = new Map(
      deals.map((deal) => [deal.id, deal.title]),
    )

    const baseItems = pageRows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      dealId: row.deal_id ?? null,
      interactionType: row.interaction_type,
      title: row.title ?? null,
      body: row.body ?? null,
      status: row.status,
      scheduledAt: toIsoString(row.scheduled_at),
      occurredAt: toIsoString(row.occurred_at),
      priority: row.priority ?? null,
      authorUserId: row.author_user_id ?? null,
      ownerUserId: row.owner_user_id ?? null,
      appearanceIcon: row.appearance_icon ?? null,
      appearanceColor: row.appearance_color ?? null,
      source: row.source ?? null,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
      authorName: row.author_user_id ? userMap.get(row.author_user_id)?.name ?? null : null,
      authorEmail: row.author_user_id ? userMap.get(row.author_user_id)?.email ?? null : null,
      dealTitle: row.deal_id ? dealMap.get(row.deal_id) ?? null : null,
      customValues: customFieldValues[row.id] ?? null,
    }))

    const enricherContext = await buildEnricherContext(container, auth, selectedOrganizationId)
    const enriched = await applyResponseEnrichers(baseItems, 'customers.interaction', enricherContext)

    let nextCursor: string | undefined
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]
      nextCursor = encodeCursor({
        id: last.id,
        sortValue: normalizeCursorValue(last.__sort_value, sortConfig.type),
      })
    }

    return NextResponse.json({
      items: enriched.items,
      nextCursor,
    })
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.issues },
        { status: 400 },
      )
    }
    console.error('customers.interactions.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('customers.interactions.load.error', 'Failed to load interactions.') },
      { status: 500 },
    )
  }
}

const interactionListItemSchema = z
  .object({
    id: z.string().uuid(),
    entityId: z.string().uuid().nullable(),
    dealId: z.string().uuid().nullable(),
    interactionType: z.string(),
    title: z.string().nullable(),
    body: z.string().nullable(),
    status: z.string(),
    scheduledAt: z.string().nullable(),
    occurredAt: z.string().nullable(),
    priority: z.number().nullable(),
    authorUserId: z.string().uuid().nullable(),
    ownerUserId: z.string().uuid().nullable(),
    appearanceIcon: z.string().nullable().optional(),
    appearanceColor: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    authorName: z.string().nullable().optional(),
    authorEmail: z.string().nullable().optional(),
    dealTitle: z.string().nullable().optional(),
    customValues: z.record(z.string(), z.unknown()).nullable().optional(),
    _integrations: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const interactionListResponseSchema = z.object({
  items: z.array(interactionListItemSchema),
  nextCursor: z.string().optional(),
})

const interactionCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Interaction',
  querySchema: listSchema,
  listResponseSchema: interactionListResponseSchema,
  create: {
    schema: interactionCreateSchema,
    responseSchema: interactionCreateResponseSchema,
    description: 'Creates a new interaction linked to a customer entity or deal.',
  },
  update: {
    schema: interactionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates fields for an existing interaction.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an interaction identified by `id`. Accepts id via body or query string.',
  },
})
