/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Material } from '../../data/entities'
import {
  createMaterialSchema,
  updateMaterialSchema,
  materialKindSchema,
  materialLifecycleStateSchema,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createMaterialsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
// Import command module side-effects so the registry has the handlers when this route loads.
import '../../commands'

// Hard-coded entity ID — `E.materials.material` becomes available after `yarn generate`
// regenerates `apps/mercato/.mercato/generated/entities.ids.generated.ts`. Until that runs,
// the literal keeps the route compilable. Step 3 commit triggers the regen as part of
// the standard "yarn generate after module changes" routine.
const MATERIAL_ENTITY_ID = 'materials:material'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    kind: materialKindSchema.optional(),
    lifecycleState: materialLifecycleStateSchema.optional(),
    isPurchasable: z.coerce.boolean().optional(),
    isSellable: z.coerce.boolean().optional(),
    isStockable: z.coerce.boolean().optional(),
    isProducible: z.coerce.boolean().optional(),
    ids: z.string().optional(), // comma-separated UUIDs (per AGENTS.md CRUD multi-id filter convention)
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['materials.material.view'] },
  POST: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['materials.material.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Material,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: MATERIAL_ENTITY_ID,
    fields: [
      'id',
      'code',
      'name',
      'description',
      'kind',
      'lifecycle_state',
      'replacement_material_id',
      'base_unit_id',
      'is_purchasable',
      'is_sellable',
      'is_stockable',
      'is_producible',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = { deletedAt: null }
      if (query.kind) filters.kind = query.kind
      if (query.lifecycleState) filters.lifecycleState = query.lifecycleState
      if (query.isPurchasable !== undefined) filters.isPurchasable = query.isPurchasable
      if (query.isSellable !== undefined) filters.isSellable = query.isSellable
      if (query.isStockable !== undefined) filters.isStockable = query.isStockable
      if (query.isProducible !== undefined) filters.isProducible = query.isProducible
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [{ code: { $ilike: pattern } }, { name: { $ilike: pattern } }]
      }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0)
        if (ids.length > 0) filters.id = { $in: ids }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'materials.material.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return createMaterialSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.materialId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'materials.material.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return updateMaterialSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'materials.material.delete',
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
            error: translate('materials.material.errors.id_required', 'Material id is required'),
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
export const GET = crud.GET

// ── OpenAPI ────────────────────────────────────────────────────────────────────

const materialListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  kind: materialKindSchema,
  lifecycle_state: materialLifecycleStateSchema,
  replacement_material_id: z.string().uuid().nullable().optional(),
  base_unit_id: z.string().uuid().nullable().optional(),
  is_purchasable: z.boolean(),
  is_sellable: z.boolean(),
  is_stockable: z.boolean(),
  is_producible: z.boolean(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createMaterialsCrudOpenApi({
  resourceName: 'Material',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(materialListItemSchema),
  create: {
    schema: createMaterialSchema,
    description:
      'Creates a material in the current organization. `is_sellable` cannot be set directly here — toggle via PUT/DELETE on `/api/materials/{id}/sales-profile`.',
  },
  update: {
    schema: updateMaterialSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates an existing material. `is_sellable` is materialized from MaterialSalesProfile existence and cannot be set via this endpoint.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a material identified by `id` (provided via body or query string). Children (units, supplier links, prices, sales profile) are not auto-cascaded by this endpoint — see Step 6+ commands.',
  },
})
