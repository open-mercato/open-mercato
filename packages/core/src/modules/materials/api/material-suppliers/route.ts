/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MaterialSupplierLink } from '../../data/entities'
import {
  createMaterialSupplierLinkSchema,
  updateMaterialSupplierLinkSchema,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createMaterialsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import '../../commands'

const MATERIAL_SUPPLIER_LINK_ENTITY_ID = 'materials:material_supplier_link'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    materialId: z.string().uuid().optional(),
    supplierCompanyId: z.string().uuid().optional(),
    preferred: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['materials.supplier_link.view'] },
  POST: { requireAuth: true, requireFeatures: ['materials.supplier_link.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['materials.supplier_link.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['materials.supplier_link.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: MaterialSupplierLink,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: MATERIAL_SUPPLIER_LINK_ENTITY_ID,
    fields: [
      'id',
      'material_id',
      'supplier_company_id',
      'supplier_sku',
      'min_order_qty',
      'lead_time_days',
      'preferred',
      'notes',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = { deletedAt: null }
      if (query.materialId) filters.materialId = query.materialId
      if (query.supplierCompanyId) filters.supplierCompanyId = query.supplierCompanyId
      if (query.preferred !== undefined) filters.preferred = query.preferred
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'materials.supplier_link.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return createMaterialSupplierLinkSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.supplierLinkId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'materials.supplier_link.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return updateMaterialSupplierLinkSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'materials.supplier_link.remove',
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
            error: translate('materials.supplier_link.errors.id_required', 'Supplier link id is required'),
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

const supplierLinkListItemSchema = z.object({
  id: z.string().uuid(),
  material_id: z.string().uuid(),
  supplier_company_id: z.string().uuid(),
  supplier_sku: z.string().nullable().optional(),
  min_order_qty: z.string().nullable().optional(),
  lead_time_days: z.number().nullable().optional(),
  preferred: z.boolean(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createMaterialsCrudOpenApi({
  resourceName: 'MaterialSupplierLink',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(supplierLinkListItemSchema),
  create: {
    schema: createMaterialSupplierLinkSchema,
    description:
      'Links a supplier (CustomerCompanyProfile) to a material. Validator rejects cross-org supplier IDs (404). At most one preferred supplier per material — toggling preferred=true clears the previous preferred for the same material.',
  },
  update: {
    schema: updateMaterialSupplierLinkSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a supplier link. Setting preferred=true demotes any sibling preferred for the same material. Supplier company cannot be reassigned (delete + recreate instead, since the (material, supplier) pair is the natural identity).',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes the supplier link. Price history attached to this link (Step 8) is preserved.',
  },
})
