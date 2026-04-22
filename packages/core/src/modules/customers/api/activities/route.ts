/**
 * @deprecated Use /api/customers/interactions instead. This route is maintained
 * as a compatibility bridge per SPEC-046b and delegates writes to canonical
 * interaction commands.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerActivity, CustomerDeal, CustomerInteraction } from '../../data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { activityCreateSchema, activityUpdateSchema } from '../../data/validators'
import { createCustomersCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import {
  mapInteractionRecordToActivitySummary,
  CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
} from '../../lib/interactionCompatibility'
import { resolveCustomerInteractionFeatureFlags } from '../../lib/interactionFeatureFlags'
import { resolveCustomersRequestContext } from '../../lib/interactionRequestContext'
import { hydrateCanonicalInteractions } from '../../lib/interactionReadModel'

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  entityId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  activityType: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

const activityCreateBodySchema = activityCreateSchema.omit({
  organizationId: true,
  tenantId: true,
}).passthrough()

const activityUpdateBodySchema = activityUpdateSchema.omit({
  organizationId: true,
  tenantId: true,
}).passthrough()

const activityDeleteBodySchema = z.object({
  id: z.string().uuid(),
})

const ADAPTER_HEADERS = {
  Deprecation: 'true',
  Sunset: 'Tue, 30 Jun 2026 00:00:00 GMT',
  Link: '</api/customers/interactions>; rel="successor-version"',
}

type ActivityItem = {
  id: string
  activityType: string
  subject?: string | null
  body?: string | null
  occurredAt?: string | null
  createdAt: string
  appearanceIcon?: string | null
  appearanceColor?: string | null
  entityId?: string | null
  authorUserId?: string | null
  authorName?: string | null
  authorEmail?: string | null
  dealId?: string | null
  dealTitle?: string | null
  customValues?: Record<string, unknown> | null
  activityTypeLabel?: string | null
}

type CanonicalActivityListResult = {
  items: ActivityItem[]
  total: number
  bridgeIds: Set<string>
}

function resolveGuardUserId(auth: {
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

function withAdapterHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  Object.entries(ADAPTER_HEADERS).forEach(([key, value]) => headers.set(key, value))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function legacyAdaptersDisabledResponse(): Promise<Response> {
  const { translate } = await resolveTranslations()
  return withAdapterHeaders(NextResponse.json(
    {
      error: translate(
        'customers.interactions.legacyAdapters.disabled',
        'This legacy adapter has been disabled. Use /api/customers/interactions instead.',
      ),
    },
    { status: 410 },
  ))
}

function buildLegacyOrderBy(sortField: string | undefined, sortDir: 'asc' | 'desc') {
  if (sortField === 'createdAt') {
    return { createdAt: sortDir }
  }
  return { occurredAt: sortDir, createdAt: sortDir } as const
}

function buildCanonicalOrderBy(sortField: string | undefined, sortDir: 'asc' | 'desc') {
  if (sortField === 'createdAt') {
    return { createdAt: sortDir }
  }
  return { occurredAt: sortDir, createdAt: sortDir } as const
}

function resolveActivitySortValue(item: ActivityItem, sortField: string | undefined): number {
  const raw =
    sortField === 'createdAt'
      ? item.createdAt
      : item.occurredAt ?? item.createdAt
  const timestamp = raw ? new Date(raw).getTime() : Number.NaN
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function sortActivityItems(
  items: ActivityItem[],
  sortField: string | undefined,
  sortDir: 'asc' | 'desc',
): ActivityItem[] {
  return [...items].sort((left, right) => {
    const leftValue = resolveActivitySortValue(left, sortField)
    const rightValue = resolveActivitySortValue(right, sortField)
    if (leftValue === rightValue) {
      return sortDir === 'asc'
        ? left.id.localeCompare(right.id)
        : right.id.localeCompare(left.id)
    }
    return sortDir === 'asc' ? leftValue - rightValue : rightValue - leftValue
  })
}

function paginateActivityItems(
  items: ActivityItem[],
  page: number,
  pageSize: number,
): { items: ActivityItem[]; total: number } {
  const start = (page - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
  }
}

async function decorateActivityItems(
  em: EntityManager,
  items: ActivityItem[],
  decryptionScope?: { tenantId: string; organizationId: string },
): Promise<ActivityItem[]> {
  if (items.length === 0) return items

  const authorIds = Array.from(
    new Set(
      items
        .map((item) => (typeof item.authorUserId === 'string' ? item.authorUserId : null))
        .filter((value): value is string => !!value),
    ),
  )
  const dealIds = Array.from(
    new Set(
      items
        .map((item) => (typeof item.dealId === 'string' ? item.dealId : null))
        .filter((value): value is string => !!value),
    ),
  )

  const [users, deals] = await Promise.all([
    authorIds.length > 0 ? em.find(User, { id: { $in: authorIds } }) : Promise.resolve([]),
    dealIds.length > 0
      ? decryptionScope
        ? findWithDecryption(em, CustomerDeal, { id: { $in: dealIds } }, undefined, decryptionScope)
        : em.find(CustomerDeal, { id: { $in: dealIds } })
      : Promise.resolve([]),
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
  const dealMap = new Map(deals.map((deal) => [deal.id, deal.title]))

  return items.map((item) => ({
    ...item,
    activityTypeLabel: item.activityType,
    authorName: item.authorUserId ? userMap.get(item.authorUserId)?.name ?? null : null,
    authorEmail: item.authorUserId ? userMap.get(item.authorUserId)?.email ?? null : null,
    dealTitle: item.dealId ? dealMap.get(item.dealId) ?? null : null,
  }))
}

function mapLegacyActivity(activity: CustomerActivity): ActivityItem {
  return {
    id: activity.id,
    activityType: activity.activityType,
    subject: activity.subject ?? null,
    body: activity.body ?? null,
    occurredAt: activity.occurredAt ? activity.occurredAt.toISOString() : null,
    createdAt: activity.createdAt.toISOString(),
    appearanceIcon: activity.appearanceIcon ?? null,
    appearanceColor: activity.appearanceColor ?? null,
    entityId: typeof activity.entity === 'string' ? activity.entity : activity.entity.id,
    authorUserId: activity.authorUserId ?? null,
    dealId: activity.deal ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id) : null,
    customValues: null,
  }
}

async function loadLegacyActivityCustomValues(
  em: EntityManager,
  activity: CustomerActivity,
): Promise<Record<string, unknown> | null> {
  const values = await loadCustomFieldValues({
    em,
    entityId: 'customers:customer_activity',
    recordIds: [activity.id],
    tenantIdByRecord: { [activity.id]: activity.tenantId },
    organizationIdByRecord: { [activity.id]: activity.organizationId },
    tenantFallbacks: [activity.tenantId],
  })
  return values[activity.id] ?? null
}

async function ensureCanonicalActivityBridge(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: Parameters<CommandBus['execute']>[1]['ctx'],
  activity: CustomerActivity,
): Promise<string> {
  const existing = await em.findOne(CustomerInteraction, { id: activity.id })
  if (existing) return existing.id

  const entityId = typeof activity.entity === 'string' ? activity.entity : activity.entity.id
  const dealId = activity.deal
    ? (typeof activity.deal === 'string' ? activity.deal : activity.deal.id)
    : null
  const customValues = await loadLegacyActivityCustomValues(em, activity)

  await commandBus.execute('customers.interactions.create', {
    input: {
      id: activity.id,
      entityId,
      interactionType: activity.activityType,
      title: activity.subject ?? null,
      body: activity.body ?? null,
      occurredAt: activity.occurredAt ?? null,
      status: activity.occurredAt ? 'done' : 'planned',
      dealId,
      authorUserId: activity.authorUserId ?? null,
      appearanceIcon: activity.appearanceIcon ?? null,
      appearanceColor: activity.appearanceColor ?? null,
      source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
      ...(customValues ? { customValues } : {}),
    },
    ctx: commandContext,
  })

  return activity.id
}

async function resolveCanonicalActivityTargetId(
  em: EntityManager,
  commandBus: CommandBus,
  commandContext: Parameters<CommandBus['execute']>[1]['ctx'],
  targetId: string,
): Promise<string> {
  const existing = await em.findOne(CustomerInteraction, { id: targetId })
  if (existing) return existing.id

  const legacy = await em.findOne(CustomerActivity, { id: targetId }, { populate: ['entity', 'deal'] })
  if (!legacy) return targetId

  return ensureCanonicalActivityBridge(
    em,
    commandBus,
    commandContext,
    legacy,
  )
}

async function listCanonicalActivities(
  em: EntityManager,
  container: { resolve: (name: string) => unknown },
  auth: { tenantId: string | null; orgId: string | null; sub?: string | null; userId?: string | null; keyId?: string | null },
  selectedOrganizationId: string | null,
  tenantId: string,
  organizationIds: string[] | null,
  query: z.infer<typeof listSchema>,
  options?: { includeDeleted?: boolean; source?: string | string[] | null; paginate?: boolean },
): Promise<CanonicalActivityListResult> {
  const where: Record<string, unknown> = {
    tenantId,
    interactionType: { $ne: 'task' },
  }
  if (!options?.includeDeleted) {
    where.deletedAt = null
  }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (query.entityId) where.entity = query.entityId
  if (query.dealId) where.dealId = query.dealId
  if (query.activityType) where.interactionType = query.activityType
  if (options?.source) {
    where.source = Array.isArray(options.source) ? { $in: options.source } : options.source
  }

  const findOptions = {
    orderBy: buildCanonicalOrderBy(query.sortField, query.sortDir ?? 'desc'),
    ...(options?.paginate === false
      ? {}
      : {
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
  }

  const rows =
    options?.paginate === false
      ? await em.find(CustomerInteraction, where, findOptions)
      : (await em.findAndCount(CustomerInteraction, where, findOptions))[0]
  const total =
    options?.paginate === false
      ? rows.filter((row) => !row.deletedAt).length
      : await em.count(CustomerInteraction, where)

  const activeRows = rows.filter((row) => !row.deletedAt)
  const hydrated = await hydrateCanonicalInteractions({
    em,
    container,
    auth,
    selectedOrganizationId,
    interactions: activeRows,
  })
  const items = hydrated.map((row) => ({
    ...mapInteractionRecordToActivitySummary(row),
    customValues: row.customValues ?? null,
    activityTypeLabel: row.interactionType,
  }))

  return {
    items,
    total,
    bridgeIds: new Set(rows.map((row) => row.id)),
  }
}

async function listLegacyActivities(
  em: EntityManager,
  tenantId: string,
  organizationIds: string[] | null,
  query: z.infer<typeof listSchema>,
  options?: { paginate?: boolean },
  selectedOrganizationId?: string | null,
): Promise<{ items: ActivityItem[]; total: number }> {
  const where: Record<string, unknown> = { tenantId }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (query.entityId) where.entity = query.entityId
  if (query.dealId) where.deal = query.dealId
  if (query.activityType) where.activityType = query.activityType

  const findOptions = {
    populate: ['entity', 'deal'] as const,
    orderBy: buildLegacyOrderBy(query.sortField, query.sortDir ?? 'desc'),
    ...(options?.paginate === false
      ? {}
      : {
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
  }

  const rows =
    options?.paginate === false
      ? await em.find(CustomerActivity, where, findOptions)
      : (await em.findAndCount(CustomerActivity, where, findOptions))[0]
  const total =
    options?.paginate === false
      ? rows.length
      : await em.count(CustomerActivity, where)

  return {
    items: await decorateActivityItems(
      em,
      rows.map(mapLegacyActivity),
      selectedOrganizationId ? { tenantId, organizationId: selectedOrganizationId } : undefined,
    ),
    total,
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const query = listSchema.parse(Object.fromEntries(url.searchParams))
    const {
      auth,
      em,
      organizationIds,
      container,
      selectedOrganizationId,
    } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }

    const sortDir = query.sortDir ?? 'desc'

    const result = flags.unified
      ? await listCanonicalActivities(
          em,
          container,
          auth,
          selectedOrganizationId,
          auth.tenantId,
          organizationIds,
          query,
        )
      : await Promise.all([
        listLegacyActivities(em, auth.tenantId, organizationIds, query, { paginate: false }, selectedOrganizationId),
        listCanonicalActivities(
          em,
          container,
          auth,
          selectedOrganizationId,
          auth.tenantId,
          organizationIds,
          query,
          {
            includeDeleted: true,
            paginate: false,
            source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
          },
        ),
      ]).then(([legacy, canonical]) => {
        const merged = sortActivityItems(
          [
            ...legacy.items.filter((item) => !canonical.bridgeIds.has(item.id)),
            ...canonical.items,
          ],
          query.sortField,
          sortDir,
        )
        const paged = paginateActivityItems(merged, query.page, query.pageSize)
        return {
          items: paged.items,
          total: paged.total,
        }
      })

    return withAdapterHeaders(
      NextResponse.json({
        items: result.items,
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
      }),
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.activities.get failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { commandContext, container, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const body = await readJsonSafe<Record<string, unknown>>(request, {})
    const parsed = activityCreateBodySchema.parse(body)
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.activity',
      resourceId: parsed.entityId,
      operation: 'create',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute('customers.interactions.create', {
      input: {
        entityId: parsed.entityId,
        interactionType: parsed.activityType,
        title: parsed.subject ?? null,
        body: parsed.body ?? null,
        occurredAt: parsed.occurredAt ?? null,
        status: parsed.occurredAt ? 'done' : 'planned',
        dealId: parsed.dealId ?? null,
        authorUserId: parsed.authorUserId ?? null,
        appearanceIcon: parsed.appearanceIcon ?? null,
        appearanceColor: parsed.appearanceColor ?? null,
        source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
        customFields: (parsed as Record<string, unknown>).customFields,
        customValues: (parsed as Record<string, unknown>).customValues,
      },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.activity',
        resourceId: parsed.entityId,
        operation: 'create',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return withAdapterHeaders(
      NextResponse.json(
        {
          id:
            result &&
            typeof result === 'object' &&
            'interactionId' in result &&
            typeof result.interactionId === 'string'
              ? result.interactionId
              : result &&
                  typeof result === 'object' &&
                  'id' in result &&
                  typeof result.id === 'string'
                ? result.id
                : null,
        },
        { status: 201 },
      ),
    )
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.activities.post failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const { commandContext, container, em, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const body = await readJsonSafe<Record<string, unknown>>(request, {})
    const parsed = activityUpdateBodySchema.parse(body)
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.activity',
      resourceId: parsed.id,
      operation: 'update',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const interactionId = flags.unified
      ? parsed.id
      : await resolveCanonicalActivityTargetId(em, commandBus, commandContext, parsed.id)

    await commandBus.execute('customers.interactions.update', {
      input: {
        id: interactionId,
        interactionType: parsed.activityType,
        title: parsed.subject ?? undefined,
        body: parsed.body ?? undefined,
        occurredAt: parsed.occurredAt ?? undefined,
        status: parsed.occurredAt ? 'done' : undefined,
        dealId: parsed.dealId ?? undefined,
        authorUserId: parsed.authorUserId ?? undefined,
        appearanceIcon: parsed.appearanceIcon ?? undefined,
        appearanceColor: parsed.appearanceColor ?? undefined,
        customFields: (parsed as Record<string, unknown>).customFields,
        customValues: (parsed as Record<string, unknown>).customValues,
      },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.activity',
        resourceId: parsed.id,
        operation: 'update',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return withAdapterHeaders(NextResponse.json({ ok: true }))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.activities.put failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { commandContext, container, em, auth, selectedOrganizationId } = await resolveCustomersRequestContext(request)
    const flags = await resolveCustomerInteractionFeatureFlags(container, auth.tenantId)
    if (!flags.legacyAdapters) {
      return await legacyAdaptersDisabledResponse()
    }
    const body = await readJsonSafe<Record<string, unknown>>(request, {})
    const parsed = activityDeleteBodySchema.parse(body)
    const guardUserId = resolveGuardUserId(auth)
    const guardResult = await validateCrudMutationGuard(container, {
      tenantId: auth.tenantId,
      organizationId: selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'customers.activity',
      resourceId: parsed.id,
      operation: 'delete',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return withAdapterHeaders(NextResponse.json(guardResult.body, { status: guardResult.status }))
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const interactionId = flags.unified
      ? parsed.id
      : await resolveCanonicalActivityTargetId(em, commandBus, commandContext, parsed.id)
    await commandBus.execute('customers.interactions.delete', {
      input: { id: interactionId },
      ctx: commandContext,
    })
    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'customers.activity',
        resourceId: parsed.id,
        operation: 'delete',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }
    return withAdapterHeaders(NextResponse.json({ ok: true }))
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return withAdapterHeaders(NextResponse.json(err.body, { status: err.status }))
    }
    if (err instanceof z.ZodError) {
      return withAdapterHeaders(
        NextResponse.json({ error: 'Validation failed', details: err.issues }, { status: 400 }),
      )
    }
    console.error('customers.activities.delete failed', err)
    return withAdapterHeaders(
      NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
    )
  }
}

const activityListItemSchema = z
  .object({
    id: z.string().uuid(),
    activityType: z.string(),
    subject: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    createdAt: z.string(),
    appearanceIcon: z.string().nullable().optional(),
    appearanceColor: z.string().nullable().optional(),
    entityId: z.string().uuid().nullable().optional(),
    authorUserId: z.string().uuid().nullable().optional(),
    authorName: z.string().nullable().optional(),
    authorEmail: z.string().nullable().optional(),
    dealId: z.string().uuid().nullable().optional(),
    dealTitle: z.string().nullable().optional(),
    customValues: z.record(z.string(), z.unknown()).nullable().optional(),
    activityTypeLabel: z.string().nullable().optional(),
  })
  .passthrough()

const activityCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi: OpenApiRouteDoc = createCustomersCrudOpenApi({
  resourceName: 'Activity',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(activityListItemSchema),
  create: {
    schema: activityCreateBodySchema,
    responseSchema: activityCreateResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Creates a timeline activity. Use POST /api/customers/interactions instead.',
  },
  update: {
    schema: activityUpdateBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Updates an activity. Use PUT /api/customers/interactions instead.',
  },
  del: {
    schema: activityDeleteBodySchema,
    responseSchema: defaultOkResponseSchema,
    description: 'DEPRECATED (sunset 2026-06-30): Deletes an activity. Use DELETE /api/customers/interactions instead.',
  },
})
