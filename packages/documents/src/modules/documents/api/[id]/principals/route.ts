import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  SortDir,
  type QueryEngine,
  type QueryOptions,
  type QueryResult,
} from '@open-mercato/shared/lib/query/types'
import { sortRowsInMemory } from '@open-mercato/shared/lib/query/encrypted-sort'
import { resolveSearchMinTokenLength } from '@open-mercato/shared/lib/search/config'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import { resolveUserLabels } from '../../../lib/userLabels'
import { resolveAuthPrincipalService } from '../../../lib/platformServices'
import { DocumentShare } from '../../../data/entities'
import {
  handleDocumentsRouteError,
  resolveDocumentCapabilityProjection,
  resolveDocumentsContext,
  routeErrorSchema,
  withDocumentsContextErrors,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const principalTypeSchema = z.enum(['user', 'role'])
const principalModeSchema = z.enum(['mention', 'share'])
const MAX_PRINCIPAL_PAGES = 50
const MAX_PRINCIPAL_PAGE_SIZE = 20
const PRINCIPAL_SEARCH_MIN_LENGTH = resolveSearchMinTokenLength()
const boundedSearchSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim()
    return normalized.length === 0 ? undefined : normalized
  },
  z.string().min(PRINCIPAL_SEARCH_MIN_LENGTH).max(120).optional(),
)

export const principalsQuerySchema = z.object({
  mode: principalModeSchema.default('share'),
  type: principalTypeSchema.default('user'),
  search: boundedSearchSchema,
  page: z.coerce.number().int().min(1).max(MAX_PRINCIPAL_PAGES).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PRINCIPAL_PAGE_SIZE).default(MAX_PRINCIPAL_PAGE_SIZE),
}).superRefine((value, context) => {
  if (value.mode === 'mention' && value.type !== 'user') {
    context.addIssue({ code: 'custom', path: ['type'], message: 'documents.principals.mentionUsersOnly' })
  }
})

const principalItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  secondary: z.string().nullable(),
})

const principalsResponseSchema = z.object({
  items: z.array(principalItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
})

const PRINCIPAL_ENTITY_IDS = {
  user: 'auth:user',
  role: 'auth:role',
} as const

type PrincipalType = z.infer<typeof principalTypeSchema>
type PrincipalRecord = Record<string, unknown>

// `name` and `email` are encrypted. Sorting either in QueryEngine disables the
// database limit so it can decrypt and sort the complete result set. A stable
// id order keeps every branch SQL-pageable; the picker remains search-first.
const PRINCIPAL_SORT = [{ field: 'id', dir: SortDir.Asc }] as const

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function buildSearchPattern(search: string): string {
  return `%${escapeLikePattern(search)}%`
}

function excludedPrincipalFilter(excludedIds: readonly string[]) {
  return excludedIds.length > 0 ? { id: { $nin: [...excludedIds] } } : {}
}

function buildPrincipalFilters(
  type: PrincipalType,
  search: string | undefined,
  excludedIds: readonly string[],
) {
  if (type === 'user') {
    return search
      ? {
          is_confirmed: true,
          name: { $ilike: buildSearchPattern(search) },
          ...excludedPrincipalFilter(excludedIds),
        }
      : { is_confirmed: true, ...excludedPrincipalFilter(excludedIds) }
  }
  if (!search) return excludedIds.length > 0 ? excludedPrincipalFilter(excludedIds) : undefined
  return {
    name: { $ilike: buildSearchPattern(search) },
    ...excludedPrincipalFilter(excludedIds),
  }
}

function buildUserSearchFilters(
  search: string,
  field: 'name' | 'email' | 'intersection',
  excludedIds: readonly string[],
) {
  const pattern = `%${escapeLikePattern(search)}%`
  return {
    is_confirmed: true,
    ...(field === 'name' || field === 'intersection' ? { name: { $ilike: pattern } } : {}),
    ...(field === 'email' || field === 'intersection' ? { email: { $ilike: pattern } } : {}),
    ...excludedPrincipalFilter(excludedIds),
  }
}

function buildPrincipalQueryOptions(input: {
  type: PrincipalType
  search?: string
  page: number
  pageSize: number
  tenantId: string
  organizationId: string
  excludedIds: readonly string[]
  filters?: QueryOptions['filters']
  fields?: string[]
  sort?: QueryOptions['sort']
}): QueryOptions {
  return {
    // User name/email are encrypted. QueryEngine only selects matching ids;
    // the scoped decryption helper resolves display labels after pagination.
    fields: input.fields ?? (input.type === 'user' ? ['id'] : ['id', 'name']),
    tenantId: input.tenantId,
    // QueryEngine's organizationIds contract treats an empty entry as the
    // tenant-wide NULL partition. This includes users assigned to this document
    // organization plus tenant-wide users while still applying tokenized search
    // and automatic tenant/soft-delete guards.
    ...(input.type === 'user' ? { organizationIds: [input.organizationId, ''] } : {}),
    withDeleted: false,
    filters: input.filters ?? buildPrincipalFilters(input.type, input.search, input.excludedIds),
    sort: input.sort ?? [...PRINCIPAL_SORT],
    page: { page: input.page, pageSize: input.pageSize },
  }
}

function safeQueryTotal(result: QueryResult<PrincipalRecord>): number {
  return Number.isFinite(result.total) && result.total > 0 ? Math.floor(result.total) : 0
}

async function queryPrincipalPage(input: {
  queryEngine: QueryEngine
  type: PrincipalType
  search?: string
  page: number
  pageSize: number
  tenantId: string
  organizationId: string
  excludedIds: readonly string[]
}): Promise<QueryResult<PrincipalRecord>> {
  if (input.type !== 'user' || !input.search) {
    return input.queryEngine.query<PrincipalRecord>(
      PRINCIPAL_ENTITY_IDS[input.type],
      buildPrincipalQueryOptions(input),
    )
  }

  // A QueryEngine `$or` group compiles base-field comparisons directly. That is
  // unsafe for encrypted auth:user fields because the raw email ciphertext can
  // never satisfy ILIKE. Keep each search predicate flat so both Basic and
  // Hybrid engines route it through search_tokens. The intersection count makes
  // the union total exact without loading every duplicate solely to count it.
  const prefixSize = input.page * input.pageSize
  const common = {
    ...input,
    page: 1,
    pageSize: prefixSize,
  }
  const [nameMatches, emailMatches, intersection] = await Promise.all([
    input.queryEngine.query<PrincipalRecord>(
      PRINCIPAL_ENTITY_IDS.user,
      buildPrincipalQueryOptions({
        ...common,
        filters: buildUserSearchFilters(input.search, 'name', input.excludedIds),
      }),
    ),
    input.queryEngine.query<PrincipalRecord>(
      PRINCIPAL_ENTITY_IDS.user,
      buildPrincipalQueryOptions({
        ...common,
        filters: buildUserSearchFilters(input.search, 'email', input.excludedIds),
      }),
    ),
    input.queryEngine.query<PrincipalRecord>(
      PRINCIPAL_ENTITY_IDS.user,
      buildPrincipalQueryOptions({
        ...common,
        pageSize: 1,
        fields: ['id'],
        filters: buildUserSearchFilters(input.search, 'intersection', input.excludedIds),
        sort: [{ field: 'id', dir: SortDir.Asc }],
      }),
    ),
  ])

  const byId = new Map<string, PrincipalRecord>()
  for (const item of [...nameMatches.items, ...emailMatches.items]) {
    const id = readString(item, 'id')
    if (id && !byId.has(id)) byId.set(id, item)
  }
  const merged = sortRowsInMemory(Array.from(byId.values()), [...PRINCIPAL_SORT])
  const offset = (input.page - 1) * input.pageSize
  const items = merged.slice(offset, offset + input.pageSize)
  const nameTotal = safeQueryTotal(nameMatches)
  const emailTotal = safeQueryTotal(emailMatches)
  const overlapTotal = Math.min(nameTotal, emailTotal, safeQueryTotal(intersection))
  const total = Math.max(byId.size, nameTotal + emailTotal - overlapTotal)

  return { items, page: input.page, pageSize: input.pageSize, total }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id: documentId } = await context.params
    const url = new URL(request.url)
    const query = principalsQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))
    const requiredFeature = query.mode === 'mention' ? 'documents.view' : 'documents.share'
    const ctx = await resolveDocumentsContext(request, [requiredFeature])
    const projection = await resolveDocumentCapabilityProjection(ctx, documentId)
    const allowed = query.mode === 'mention'
      ? projection.capabilities.canComment
      : projection.capabilities.canShare
    if (!allowed) throw new CrudHttpError(403, { error: 'api.errors.forbidden' })

    const authPrincipalService = resolveAuthPrincipalService(ctx.container)
    if (!authPrincipalService) throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
    const protectedUserIds: string[] = !ctx.auth.isSuperAdmin && query.type === 'user'
      ? await authPrincipalService.listSuperAdminUserIds(ctx.tenantId)
      : []
    const existingShares = query.mode === 'share'
      ? await findWithDecryption(
          ctx.em,
          DocumentShare,
          {
            documentId,
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            principalType: query.type,
            deletedAt: null,
          },
          { fields: ['principalId'] as const },
          { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        )
      : []
    const excludedIds = Array.from(new Set([
      ...protectedUserIds,
      ...existingShares.map((share) => share.principalId),
    ]))
    let result: QueryResult<PrincipalRecord>
    if (query.type === 'role') {
      if (typeof authPrincipalService.queryActiveRolePage !== 'function') {
        throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
      }
      const rolePage = await authPrincipalService.queryActiveRolePage({
        scope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        search: query.search,
        excludedIds,
        page: query.page,
        pageSize: query.pageSize,
      })
      result = { ...rolePage, items: rolePage.items.map((item) => ({ ...item })) }
    } else {
      const queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
      result = await queryPrincipalPage({
        queryEngine,
        type: query.type,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        excludedIds,
      })
    }
    const { translate } = await resolveTranslations()
    const fallbackLabel = query.type === 'user'
      ? translate('documents.users.unknown', 'Unknown user')
      : translate('documents.roles.unknown', 'Unknown role')
    const safeFallback = sanitizeDocumentsDisplayLabel(fallbackLabel)
      ?? (query.type === 'user' ? 'Unknown user' : 'Unknown role')
    const userLabels = query.type === 'user'
      ? await resolveUserLabels(
          ctx.container,
          { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
          result.items.flatMap((item) => {
            const id = readString(item, 'id')
            return id ? [id] : []
          }),
        )
      : null
    const items = result.items.flatMap((item) => {
      const id = readString(item, 'id')
      if (!id) return []
      const resolvedUser = userLabels?.get(id) ?? null
      const label = firstSafeDocumentsDisplayLabel(
        resolvedUser?.label,
        readString(item, 'label', 'name'),
        safeFallback,
      ) ?? safeFallback
      const secondary = sanitizeDocumentsDisplayLabel(
        resolvedUser?.secondary ?? readString(item, 'secondary'),
      )
      return [{ id, label, secondary }]
    })
    const total = Math.max(0, Number.isFinite(result.total) ? result.total : items.length)
    const totalPages = Math.min(
      MAX_PRINCIPAL_PAGES,
      Math.max(1, Math.ceil(total / query.pageSize)),
    )

    return NextResponse.json(
      { items, page: query.page, pageSize: query.pageSize, total, totalPages },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.principals.list')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document-scoped principal picker',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List principals eligible for document mentions or sharing',
      description:
        'Returns a bounded, document-authorized user or role page without requiring broad Auth administration grants.',
      query: principalsQuerySchema,
      responses: [{ status: 200, description: 'Eligible principal page', schema: principalsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid picker query', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Document capability denied', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET }
