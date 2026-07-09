import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { normalizeCustomFieldResponse } from '@open-mercato/shared/lib/custom-fields/normalize'
import { applyResponseEnrichers } from '@open-mercato/shared/lib/crud/enricher-runner'
import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { resolveEncryptedSortFields, resolveEncryptedSortMaxRows } from '@open-mercato/shared/lib/query/encrypted-sort'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
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
import { applyEmailVisibilityFilter } from '../../lib/visibilityFilter'
import { resolveEncryptedSortPage } from './encryptedSortPage'
import { resolveCanonicalActivityTargetId } from '../../lib/legacyActivityBridge'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const rawBodySchema = z.object({}).passthrough()

const interactionSortFieldSchema = z.enum([
  'scheduledAt',
  'occurredAt',
  'createdAt',
  'updatedAt',
  'status',
  'priority',
  'interactionType',
  'title',
])

export const listSchema = z
  .object({
    limit: z.coerce.number().min(1).max(100).default(25),
    cursor: z.string().optional(),
    entityId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    status: z.string().optional(),
    interactionType: z.string().optional(),
    type: z.string().optional(),
    excludeInteractionType: z.string().optional(),
    search: z.string().trim().min(1).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    pinned: z.enum(['true', 'false']).optional(),
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
        const parsed = parseScopedCommandInput(interactionUpdateSchema, raw ?? {}, ctx, translate)
        // Bridge legacy `customer_activities` rows into `customer_interactions`
        // before the canonical update runs so historical activities (#1807)
        // remain editable through the new dialog. No-op when the canonical
        // record already exists.
        const tenantId = ctx.auth?.tenantId ?? null
        if (typeof parsed.id === 'string' && tenantId) {
          try {
            const em = ctx.container.resolve('em') as EntityManager
            const commandBus = ctx.container.resolve('commandBus') as CommandBus
            const commandContext: CommandRuntimeContext = {
              container: ctx.container,
              auth: ctx.auth ?? null,
              organizationScope: ctx.organizationScope ?? null,
              selectedOrganizationId: ctx.selectedOrganizationId ?? null,
              organizationIds: ctx.organizationIds ?? null,
              request: ctx.request,
            }
            await resolveCanonicalActivityTargetId(em, commandBus, commandContext, parsed.id, tenantId)
          } catch (err) {
            // Bridging is best-effort; downstream lookup will surface a 404
            // when neither canonical nor legacy rows exist.
            logger.warn('Legacy interaction bridge failed', { component: 'interactions.put', id: parsed.id, err })
          }
        }
        return parsed
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
  external_message_id: string | null
  appearance_icon: string | null
  appearance_color: string | null
  source: string | null
  duration_minutes: number | null
  location: string | null
  all_day: boolean | null
  recurrence_rule: string | null
  recurrence_end: Date | null
  participants: Array<{ userId: string; name?: string; email?: string; status?: string }> | null
  reminder_minutes: number | null
  visibility: string | null
  linked_entities: Array<{ id: string; type: string; label: string }> | null
  guest_permissions: { canInviteOthers?: boolean; canModify?: boolean; canSeeList?: boolean } | null
  pinned: boolean
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
  title: { column: 'title', type: 'text' as const, defaultDir: 'asc' as const },
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

const INTERACTION_LIST_COLUMNS = [
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
  'external_message_id',
  'appearance_icon',
  'appearance_color',
  'source',
  'duration_minutes',
  'location',
  'all_day',
  'recurrence_rule',
  'recurrence_end',
  'participants',
  'reminder_minutes',
  'visibility',
  'linked_entities',
  'guest_permissions',
  'pinned',
  'organization_id',
  'tenant_id',
  'created_at',
  'updated_at',
] as const

// Shared by both the SQL keyset path and the encrypted-sort candidate scan
// so the two paths never drift on which rows are in scope.
function applyInteractionListFilters(
  baseQuery: any,
  params: {
    tenantId: string
    organizationIds: string[]
    query: z.infer<typeof listSchema>
  },
): any {
  let q = baseQuery.where('deleted_at', 'is', null).where('tenant_id', '=', params.tenantId)
  if (params.organizationIds.length > 0) q = q.where('organization_id', 'in', params.organizationIds)
  const { query } = params
  if (query.entityId) q = q.where('entity_id', '=', query.entityId)
  if (query.dealId) q = q.where('deal_id', '=', query.dealId)
  if (query.status) q = q.where('status', '=', query.status)
  if (query.interactionType) q = q.where('interaction_type', '=', query.interactionType)
  if (query.type) {
    const types = query.type.split(',').map((t) => t.trim()).filter(Boolean)
    if (types.length > 0) q = q.where('interaction_type', 'in', types)
  }
  if (query.pinned === 'true') {
    q = q.where('pinned', '=', true)
  } else if (query.pinned === 'false') {
    q = q.where('pinned', '=', false)
  }
  if (query.excludeInteractionType) q = q.where('interaction_type', '!=', query.excludeInteractionType)
  if (query.search) {
    // NOTE: for tenants with data encryption enabled, `title`/`body` are
    // ciphertext at rest (see encryption.ts), so this ILIKE matches encrypted
    // bytes and returns no rows — substring search over encrypted free-text
    // columns is unsupported, the same documented limitation as
    // customer_activity / customer_comment. The returned page's title/body are
    // still decrypted for display further below.
    const searchTerm = `%${escapeLikePattern(query.search)}%`
    q = q.where(sql<boolean>`coalesce(title, '') ilike ${searchTerm} or coalesce(body, '') ilike ${searchTerm}`)
  }
  if (query.from) {
    q = q.where(sql<boolean>`coalesce(occurred_at, scheduled_at, created_at) >= ${query.from}`)
  }
  if (query.to) {
    q = q.where(sql<boolean>`coalesce(occurred_at, scheduled_at, created_at) <= ${query.to}`)
  }
  return q
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
  precomputedUserFeatures?: { userId: string; features: string[] | undefined },
): Promise<EnricherContext> {
  const userId =
    (typeof auth.sub === 'string' && auth.sub.trim().length > 0
      ? auth.sub
      : typeof auth.userId === 'string' && auth.userId.trim().length > 0
        ? auth.userId
        : typeof auth.keyId === 'string' && auth.keyId.trim().length > 0
          ? auth.keyId
          : 'system')

  // Reuse features already resolved for this same user (the GET handler resolves
  // them once for the visibility filter) to avoid a second RBAC lookup per request.
  const userFeatures =
    precomputedUserFeatures && precomputedUserFeatures.userId === userId
      ? precomputedUserFeatures.features
      : await resolveUserFeatures(container, userId, auth.tenantId ?? null, organizationId)

  return {
    organizationId: organizationId ?? '',
    tenantId: auth.tenantId ?? '',
    userId,
    em: container.resolve('em'),
    container,
    userFeatures,
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
    const db = em.getKysely<any>() as any

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

    // ── Email visibility filter (2026-05-27) ──────────────────────────────
    // Non-email interactions pass through; email rows with visibility='private'
    // are filtered out unless the caller is the author or has admin bypass.
    // API-key callers have no user identity (`auth.sub` undefined): resolve the
    // viewer to null so they never gain the author bypass and only see shared
    // emails (fail-closed). Mirrors counts/people/activities routes.
    const viewerUserId = auth.isApiKey ? null : (auth.sub ?? null)
    const encryptionService = resolveTenantEncryptionService(em)
    // Encrypted sort columns can't use SQL keyset ordering on ciphertext, so an
    // encrypted sort field takes a bounded candidate-scan + in-memory-sort path
    // instead of the SQL path below. Resolved alongside the independent
    // visibility-feature lookup rather than after it.
    const [callerUserFeatures, encryptedSortFields] = await Promise.all([
      viewerUserId
        ? resolveUserFeatures(container, viewerUserId, auth.tenantId ?? null, selectedOrganizationId)
        : Promise.resolve(undefined),
      resolveEncryptedSortFields(
        encryptionService,
        CUSTOMER_INTERACTION_ENTITY_ID,
        [sortConfig.column],
        auth.tenantId,
        selectedOrganizationId,
      ),
    ])
    const sortFieldIsEncrypted = encryptedSortFields.has(sortConfig.column)

    let pageRows: InteractionListRow[]
    let hasMore: boolean

    if (sortFieldIsEncrypted) {
      let candidateQuery = applyInteractionListFilters(
        db.selectFrom('customer_interactions').select(['id', sortConfig.column]),
        { tenantId: auth.tenantId, organizationIds, query },
      )
      candidateQuery = applyEmailVisibilityFilter(candidateQuery as any, {
        currentUserId: viewerUserId,
        userFeatures: callerUserFeatures,
      })
      const cap = resolveEncryptedSortMaxRows()
      if (cap !== null) {
        candidateQuery = candidateQuery.limit(cap).orderBy('id', 'asc')
      }
      const candidateRows = await candidateQuery.execute() as Array<{ id: string } & Record<string, unknown>>
      if (cap !== null && candidateRows.length >= cap) {
        logger.warn('Encrypted sort candidate scan hit OM_ENCRYPTED_SORT_MAX_ROWS cap; results may be incomplete', {
          component: 'interactions.GET',
          cap,
          sortField: sortConfig.column,
          tenantId: auth.tenantId,
        })
      }

      const decryptPayload = encryptionService?.decryptEntityPayload?.bind(encryptionService)
      const { pageIds, hasMore: encryptedHasMore } = await resolveEncryptedSortPage({
        candidates: candidateRows,
        decryptRow: async (row) => {
          if (!decryptPayload) return row
          try {
            const decrypted = await decryptPayload(CUSTOMER_INTERACTION_ENTITY_ID, row, auth.tenantId, selectedOrganizationId)
            return { ...row, ...decrypted }
          } catch (err) {
            logger.error('error decrypting sort candidate', { component: 'interactions.GET', err })
            return row
          }
        },
        sortField: sortConfig.column,
        sortDir,
        cursorId: cursor?.id ?? null,
        limit: query.limit,
      })
      hasMore = encryptedHasMore

      if (pageIds.length === 0) {
        pageRows = []
      } else {
        let pageQuery = applyInteractionListFilters(
          db.selectFrom('customer_interactions').select([...INTERACTION_LIST_COLUMNS, sql`${sql.raw(sortSql)}`.as('__sort_value')]),
          { tenantId: auth.tenantId, organizationIds, query },
        )
        pageQuery = applyEmailVisibilityFilter(pageQuery as any, {
          currentUserId: viewerUserId,
          userFeatures: callerUserFeatures,
        })
        pageQuery = pageQuery.where('id', 'in', pageIds)
        const rawPageRows = await pageQuery.execute() as InteractionListRow[]
        const byId = new Map(rawPageRows.map((row) => [row.id, row]))
        pageRows = pageIds
          .map((id) => byId.get(id))
          .filter((row): row is InteractionListRow => row != null)
      }
    } else {
      let rowsQuery = applyInteractionListFilters(
        db
          .selectFrom('customer_interactions')
          .select([...INTERACTION_LIST_COLUMNS, sql`${sql.raw(sortSql)}`.as('__sort_value')])
          .limit(query.limit + 1),
        { tenantId: auth.tenantId, organizationIds, query },
      )

      if (cursor) {
        const op = sortDir === 'asc' ? '>' : '<'
        const opRaw = sql.raw(op)
        const sortRaw = sql.raw(sortSql)
        rowsQuery = rowsQuery.where((eb: any) => eb.or([
          sql<boolean>`${sortRaw} ${opRaw} ${cursor.sortValue}`,
          eb.and([
            sql<boolean>`${sortRaw} = ${cursor.sortValue}`,
            eb('id', op, cursor.id),
          ]),
        ]))
      }

      rowsQuery = applyEmailVisibilityFilter(rowsQuery as any, {
        currentUserId: viewerUserId,
        userFeatures: callerUserFeatures,
      })

      rowsQuery = rowsQuery.orderBy(sql`${sql.raw(sortSql)} ${sql.raw(sortDir)}`).orderBy('id', sortDir)

      const rows = await rowsQuery.execute() as InteractionListRow[]
      pageRows = rows.slice(0, query.limit)
      hasMore = rows.length > query.limit
    }

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

    const [users, deals, customFieldValues, interactionRecords] = await Promise.all([
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
      interactionIds.length > 0
        ? findWithDecryption(em, CustomerInteraction, { id: { $in: interactionIds } } as never, undefined, { tenantId: auth.tenantId, organizationId: selectedOrganizationId })
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
    const dealMap = new Map(
      deals.map((deal) => [deal.id, deal.title]),
    )
    // title/body are encrypted at rest (see encryption.ts). The kysely rows above
    // carry ciphertext when tenant encryption is enabled, so override them with the
    // decrypted values from findWithDecryption for the returned page.
    const interactionContentMap = new Map(
      (interactionRecords as Array<{ id: string; title?: string | null; body?: string | null }>).map(
        (record) => [record.id, { title: record.title ?? null, body: record.body ?? null }],
      ),
    )

    const baseItems = pageRows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      dealId: row.deal_id ?? null,
      interactionType: row.interaction_type,
      title: (interactionContentMap.has(row.id) ? interactionContentMap.get(row.id)!.title : row.title) ?? null,
      body: (interactionContentMap.has(row.id) ? interactionContentMap.get(row.id)!.body : row.body) ?? null,
      status: row.status,
      scheduledAt: toIsoString(row.scheduled_at),
      occurredAt: toIsoString(row.occurred_at),
      priority: row.priority ?? null,
      authorUserId: row.author_user_id ?? null,
      ownerUserId: row.owner_user_id ?? null,
      externalMessageId: row.external_message_id ?? null,
      appearanceIcon: row.appearance_icon ?? null,
      appearanceColor: row.appearance_color ?? null,
      source: row.source ?? null,
      duration: row.duration_minutes ?? null,
      durationMinutes: row.duration_minutes ?? null,
      location: row.location ?? null,
      allDay: row.all_day ?? null,
      recurrenceRule: row.recurrence_rule ?? null,
      recurrenceEnd: toIsoString(row.recurrence_end),
      participants: row.participants ?? null,
      reminderMinutes: row.reminder_minutes ?? null,
      visibility: row.visibility ?? null,
      linkedEntities: row.linked_entities ?? null,
      guestPermissions: row.guest_permissions ?? null,
      pinned: row.pinned ?? false,
      organizationId: row.organization_id,
      tenantId: row.tenant_id,
      createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
      authorName: row.author_user_id ? userMap.get(row.author_user_id)?.name ?? null : null,
      authorEmail: row.author_user_id ? userMap.get(row.author_user_id)?.email ?? null : null,
      dealTitle: row.deal_id ? dealMap.get(row.deal_id) ?? null : null,
      customValues: normalizeCustomFieldResponse(customFieldValues[row.id]) ?? null,
    }))

    const enricherContext = await buildEnricherContext(
      container,
      auth,
      selectedOrganizationId,
      viewerUserId ? { userId: viewerUserId, features: callerUserFeatures } : undefined,
    )
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
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: err.issues },
        { status: 400 },
      )
    }
    logger.error('customers.interactions.get failed', { err })
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
    externalMessageId: z.string().uuid().nullable().optional(),
    appearanceIcon: z.string().nullable().optional(),
    appearanceColor: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
    durationMinutes: z.number().nullable().optional(),
    location: z.string().nullable().optional(),
    allDay: z.boolean().nullable().optional(),
    recurrenceRule: z.string().nullable().optional(),
    recurrenceEnd: z.string().nullable().optional(),
    participants: z.array(
      z.object({
        userId: z.string().uuid(),
        name: z.string().optional(),
        email: z.string().optional(),
        status: z.string().optional(),
      }),
    ).nullable().optional(),
    reminderMinutes: z.number().nullable().optional(),
    visibility: z.string().nullable().optional(),
    linkedEntities: z.array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
        label: z.string(),
      }),
    ).nullable().optional(),
    guestPermissions: z
      .object({
        canInviteOthers: z.boolean().optional(),
        canModify: z.boolean().optional(),
        canSeeList: z.boolean().optional(),
      })
      .nullable()
      .optional(),
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
