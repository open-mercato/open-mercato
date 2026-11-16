import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/promotion'
import { Promotion } from '../data/entities'
import { promotionCreateSchema, promotionUpdateSchema, promotionDeleteSchema } from '../data/validators'
import { createPromotionsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

// Rev (W2, §Architecture): this file is `api/route.ts`, not `api/promotions/route.ts` —
// Next.js route auto-discovery maps a module's `api/<path>/route.ts` to `/api/<path>`,
// so a file at the `api/` root with no `<path>` segment mounts at the module's own root,
// `/api/promotions`, not `/api/promotions/promotions`.

const rawBodySchema = z.object({}).passthrough()

export const promotionListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    active: z.string().optional(),
    cumulative: z.string().optional(),
    tags: z.string().optional(),
    startsFrom: z.coerce.date().optional(),
    startsTo: z.coerce.date().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type PromotionListQuery = z.infer<typeof promotionListQuerySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['promotions.view'] },
  POST: { requireAuth: true, requireFeatures: ['promotions.create'] },
  PUT: { requireAuth: true, requireFeatures: ['promotions.update'] },
  DELETE: { requireAuth: true, requireFeatures: ['promotions.delete'] },
}

export const metadata = routeMetadata

// §API Contracts `GET /api/promotions`: `page`, `pageSize` (max 100), `search`, `active`,
// `cumulative`, `tags`, `startsFrom`, `startsTo`.
function buildPromotionListFilters(query: PromotionListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search) {
    const pattern = buildIlikeTerm(query.search)
    filters.$or = [{ name: { $ilike: pattern } }, { description: { $ilike: pattern } }]
  }
  const active = parseBooleanToken(query.active)
  if (active !== null) filters.active = { $eq: active }
  const cumulative = parseBooleanToken(query.cumulative)
  if (cumulative !== null) filters.cumulative = { $eq: cumulative }
  // `tags` is a postgres `text[]` column (§Data Models) — `$overlap` ("has any of",
  // packages/shared/src/lib/query/types.ts) compiles to `&&` for an array-typed base
  // column, matching the "any of the given tags" semantics the admin filter chip implies.
  const tagList = parseCommaSeparatedList(query.tags)
  if (tagList.length) filters.tags = { $overlap: tagList }
  if (query.startsFrom || query.startsTo) {
    const startsAt: Record<string, unknown> = {}
    if (query.startsFrom) startsAt.$gte = query.startsFrom
    if (query.startsTo) startsAt.$lte = query.startsTo
    filters.starts_at = startsAt
  }
  return filters
}

// §API Contracts "Optimistic locking": list/detail responses carry `updatedAt` so
// `CrudForm` can auto-derive its conflict header from `initialValues.updatedAt`.
const promotionListItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  order: z.number(),
  active: z.boolean(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  cumulative: z.boolean(),
  tags: z.array(z.string()),
  excludedTags: z.array(z.string()),
  excludeFlags: z.record(z.string(), z.boolean()),
  eligibleCurrencies: z.array(z.string()),
  maxBudget: z.string().nullable().optional(),
  budgetCurrency: z.string().nullable().optional(),
  ruleGroupId: z.string().uuid().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

const crud = makeCrudRoute<unknown, unknown, PromotionListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: Promotion,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  // Same entityId `commands/promotions.ts` (Step 1.3) already uses for its own
  // `emitCrudSideEffects`/`emitCrudUndoSideEffects` indexer config — kept consistent so
  // both the command-driven writes here and Step 1.3's undo path index the same entity.
  indexer: { entityType: E.promotions.promotion },
  list: {
    schema: promotionListQuerySchema,
    entityId: E.promotions.promotion,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.description,
      F.order,
      F.active,
      F.starts_at,
      F.ends_at,
      F.cumulative,
      F.tags,
      F.excluded_tags,
      F.exclude_flags,
      F.eligible_currencies,
      F.max_budget,
      F.budget_currency,
      F.rule_group_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      order: F.order,
      startsAt: F.starts_at,
      endsAt: F.ends_at,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildPromotionListFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      name: item.name,
      description: item.description ?? null,
      order: item.order,
      active: item.active,
      startsAt: item.starts_at ?? null,
      endsAt: item.ends_at ?? null,
      cumulative: item.cumulative,
      tags: item.tags ?? [],
      excludedTags: item.excluded_tags ?? [],
      excludeFlags: item.exclude_flags ?? {},
      eligibleCurrencies: item.eligible_currencies ?? [],
      maxBudget: item.max_budget ?? null,
      budgetCurrency: item.budget_currency ?? null,
      ruleGroupId: item.rule_group_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  // Command-driven writes (per `packages/core/AGENTS.md` → "### CRUD Routes" /
  // "Command Side Effects"): create/update/delete all delegate to the Step 1.3 commands
  // rather than mutating the entity directly, so undo/audit/indexing stay owned by
  // `commands/promotions.ts`. `orm.entity` above still backs the list query and the
  // auto-registered optimistic-lock reader (resourceKind `promotions.promotion`, the same
  // value `commands/rule-tree.ts`'s `PROMOTION_RESOURCE_KIND` uses) — the row-level
  // mutation guard for PUT/DELETE (including the optimistic-lock conflict check) runs
  // automatically off that reader whenever the mapped command input carries a top-level
  // `id`, which both actions below do.
  actions: {
    create: {
      commandId: 'promotions.promotion.create',
      schema: rawBodySchema,
      mapInput: ({ raw }) => promotionCreateSchema.parse(raw ?? {}),
      response: ({ result }) => ({ id: (result as { promotionId?: string } | null)?.promotionId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'promotions.promotion.update',
      schema: rawBodySchema,
      mapInput: ({ raw }) => promotionUpdateSchema.parse(raw ?? {}),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'promotions.promotion.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const raw = parsed as { body?: Record<string, unknown>; query?: Record<string, unknown>; id?: unknown } | null | undefined
        const id =
          (raw?.body?.id as string | undefined) ??
          (raw?.id as string | undefined) ??
          (raw?.query?.id as string | undefined) ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('promotions.errors.id_required', 'Promotion id is required') })
        }
        return promotionDeleteSchema.parse({ id })
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = createPromotionsCrudOpenApi({
  resourceName: 'Promotion',
  querySchema: promotionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(promotionListItemSchema),
  create: {
    schema: promotionCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a promotion with an empty root rule group; tree mutations use a separate endpoint.',
  },
  update: {
    schema: promotionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates promotion metadata only. Tree mutations use PUT /api/promotions/[id]/tree.',
  },
  del: {
    schema: promotionDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a promotion by id; cascades to its rule group tree via DB constraints.',
  },
})
