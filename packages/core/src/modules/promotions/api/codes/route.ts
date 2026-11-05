import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/code'
import { Code } from '../../data/entities'
import {
  promotionCodeCreateSchema,
  promotionCodeUpdateSchema,
  promotionCodeDeleteSchema,
  promotionCodeTypeValues,
} from '../../data/validators'
import { createPromotionsCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'

// Release 4 PLAN.md Step 6.4 / SPEC-055 §API Contracts `GET|POST|PUT|DELETE
// /api/promotions/codes`. Literal template of `../route.ts` (the `Promotion` CRUD
// route) — same `makeCrudRoute` shape, same OpenAPI factory, same command-driven-write
// convention (`commands/codes.ts`'s create/update/delete). Next.js file-based routing
// maps `api/codes/route.ts` to `/api/promotions/codes` (this module's own `api/` root is
// `/api/promotions`, per `api/route.ts`'s own rev W2 comment).

const rawBodySchema = z.object({}).passthrough()

export const codeListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    type: z.string().optional(),
    active: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type CodeListQuery = z.infer<typeof codeListQuerySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
  POST: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['promotions.codes.manage'] },
}

export const metadata = routeMetadata

// §API Contracts `GET /api/promotions/codes`: `page`, `pageSize`, `search`, `type`, `active`.
function buildCodeListFilters(query: CodeListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search) {
    const pattern = buildIlikeTerm(query.search)
    filters.$or = [{ name: { $ilike: pattern } }, { code: { $ilike: pattern } }]
  }
  if (query.type && (promotionCodeTypeValues as readonly string[]).includes(query.type)) {
    filters.type = { $eq: query.type }
  }
  const active = parseBooleanToken(query.active)
  if (active !== null) filters.active = { $eq: active }
  return filters
}

// §API Contracts "Optimistic locking" (default-on, root AGENTS.md): list/detail responses
// carry `updatedAt` so `CrudForm` can auto-derive its conflict header.
const codeListItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  name: z.string(),
  type: z.enum(promotionCodeTypeValues),
  code: z.string().nullable().optional(),
  prefix: z.string().nullable().optional(),
  suffix: z.string().nullable().optional(),
  length: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  generated: z.number(),
  used: z.number(),
  usage: z.string(),
  usageAmount: z.number().nullable().optional(),
  usagePerCustomer: z.number().nullable().optional(),
  active: z.boolean(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

const crud = makeCrudRoute<unknown, unknown, CodeListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: Code,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  // Same entityId `commands/codes.ts`'s own `emitCrudSideEffects`/`emitCrudUndoSideEffects`
  // indexer config uses, so command-driven writes and undo index the same entity.
  indexer: { entityType: E.promotions.code },
  list: {
    schema: codeListQuerySchema,
    entityId: E.promotions.code,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.type,
      F.code,
      F.prefix,
      F.suffix,
      F.length,
      F.amount,
      F.generated,
      F.used,
      F.usage,
      F.usage_amount,
      F.usage_per_customer,
      F.active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      type: F.type,
      amount: F.amount,
      generated: F.generated,
      used: F.used,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildCodeListFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      name: item.name,
      type: item.type,
      code: item.code ?? null,
      prefix: item.prefix ?? null,
      suffix: item.suffix ?? null,
      length: item.length ?? null,
      amount: item.amount ?? null,
      generated: item.generated,
      used: item.used,
      usage: item.usage,
      usageAmount: item.usage_amount ?? null,
      usagePerCustomer: item.usage_per_customer ?? null,
      active: item.active,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  // Command-driven writes (per `packages/core/AGENTS.md` → "### CRUD Routes" /
  // "Command Side Effects"): create/update/delete all delegate to `commands/codes.ts`
  // rather than mutating the entity directly, so undo/audit/indexing stay owned there.
  // `orm.entity` above still backs the list query and the auto-registered
  // optimistic-lock reader (resourceKind `promotions.code`, derived from the
  // `promotions.code.update`/`.delete` command ids below) — the row-level mutation guard
  // for PUT/DELETE (including the optimistic-lock conflict check) runs automatically off
  // that reader whenever the mapped command input carries a top-level `id`, which both
  // actions below do.
  actions: {
    create: {
      commandId: 'promotions.code.create',
      schema: rawBodySchema,
      mapInput: ({ raw }) => promotionCodeCreateSchema.parse(raw ?? {}),
      response: ({ result }) => ({ id: (result as { codeId?: string } | null)?.codeId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'promotions.code.update',
      schema: rawBodySchema,
      mapInput: ({ raw }) => promotionCodeUpdateSchema.parse(raw ?? {}),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'promotions.code.delete',
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
          throw new CrudHttpError(400, { error: translate('promotions.errors.id_required', 'Promotion code id is required') })
        }
        return promotionCodeDeleteSchema.parse({ id })
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
  resourceName: 'PromotionCode',
  querySchema: codeListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(codeListItemSchema),
  create: {
    schema: promotionCodeCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a promotional code. For a dynamic code, also triggers the background generation worker to fill the pool to `amount`.',
  },
  update: {
    schema: promotionCodeUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a promotional code\'s metadata.',
  },
  del: {
    schema: promotionCodeDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a promotional code by id and deactivates its already-generated codes.',
  },
})
