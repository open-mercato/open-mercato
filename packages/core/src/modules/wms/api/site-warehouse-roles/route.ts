import { z } from "zod";
import { makeCrudRoute } from "@open-mercato/shared/lib/crud/factory";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import {
  parseScopedCommandInput,
  resolveCrudRecordId,
} from "@open-mercato/shared/lib/api/scoped";
import { E } from "#generated/entities.ids.generated";
import { SiteWarehouseRole } from "../../data/entities";
import {
  siteWarehouseRoleCreateSchema,
  siteWarehouseRoleUpdateSchema,
  siteWarehouseRoleSchema,
} from "../../data/validators";
import {
  booleanQueryFilterSchema,
  localizeSiteValidationResult,
  parseSiteWarehouseRoleUpdateInput,
  uuidListQueryFilterSchema,
} from "../siteValidation";
import {
  createPagedListResponseSchema,
  createWmsCrudOpenApi,
  defaultOkResponseSchema,
} from "../openapi";
import { attachWarehouseLabelsToListItems } from "../listEnrichers";

const metadata = {
  GET: { requireAuth: true, requireFeatures: ["wms.view"] },
  POST: { requireAuth: true, requireFeatures: ["wms.manage_sites"] },
  PUT: { requireAuth: true, requireFeatures: ["wms.manage_sites"] },
  DELETE: { requireAuth: true, requireFeatures: ["wms.manage_sites"] },
};
export { metadata };
const rawBodySchema = z.object({}).passthrough();
const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(25),
    siteId: z.string().uuid().optional(),
    warehouseId: z.string().uuid().optional(),
    role: siteWarehouseRoleSchema.optional(),
    isDefault: booleanQueryFilterSchema.optional(),
    ids: uuidListQueryFilterSchema.optional(),
    sortField: z
      .enum(["role", "isDefault", "createdAt", "updatedAt"])
      .optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .passthrough();
const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: SiteWarehouseRole,
    idField: "id",
    orgField: "organizationId",
    tenantField: "tenantId",
    softDeleteField: "deletedAt",
  },
  indexer: { entityType: E.wms.site_warehouse_role },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.site_warehouse_role,
    fields: [
      "id",
      "organization_id",
      "tenant_id",
      "site_id",
      "warehouse_id",
      "role",
      "is_default",
      "created_at",
      "updated_at",
    ],
    sortFieldMap: {
      role: "role",
      isDefault: "is_default",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {};
      if (query.siteId) filters.site_id = { $eq: query.siteId };
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId };
      if (query.role) filters.role = { $eq: query.role };
      if (query.isDefault === "true" || query.isDefault === "false")
        filters.is_default = { $eq: query.isDefault === "true" };
      if (query.ids)
        filters.id = {
          $in: query.ids
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        };
      return filters;
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      siteId: item.site_id ?? null,
      warehouseId: item.warehouse_id ?? null,
      role: item.role ?? null,
      isDefault: item.is_default === true,
      warehouse: {
        id: item.warehouse_id ?? null,
        code: item.warehouse_code ?? null,
        name: item.warehouse_name ?? null,
        isActive: item.warehouse_is_active === true,
      },
      createdAt: item.created_at ?? null,
      updatedAt: item.updated_at ?? null,
    }),
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : [];
      for (const item of items) item.warehouse_id = item.warehouseId;
      await attachWarehouseLabelsToListItems(payload, ctx);
      for (const item of items) {
        item.warehouse = {
          id: item.warehouseId ?? null,
          code: item.warehouse_code ?? null,
          name: item.warehouse_name ?? null,
          isActive: item.warehouse_is_active === true,
        };
        delete item.warehouse_id;
        delete item.warehouse_code;
        delete item.warehouse_name;
        delete item.warehouse_is_active;
      }
    },
  },
  actions: {
    create: {
      commandId: "wms.site-warehouse-roles.create",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return localizeSiteValidationResult(
          () => {
            const parsed = parseScopedCommandInput(
              siteWarehouseRoleCreateSchema,
              raw ?? {},
              ctx,
              translate,
            );
            return siteWarehouseRoleCreateSchema.parse(parsed);
          },
          translate,
        );
      },
      response: ({ result }) => ({ id: result?.assignmentId ?? null }),
      status: 201,
    },
    update: {
      commandId: "wms.site-warehouse-roles.update",
      schema: rawBodySchema,
      mapInput: async ({ raw }) => {
        const { translate } = await resolveTranslations();
        return parseSiteWarehouseRoleUpdateInput(raw, translate);
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: "wms.site-warehouse-roles.delete",
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => ({
        id: resolveCrudRecordId(
          parsed,
          ctx,
          (await resolveTranslations()).translate,
        ),
      }),
      response: () => ({ ok: true }),
    },
  },
});
export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;
const itemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  role: siteWarehouseRoleSchema.nullable().optional(),
  isDefault: z.boolean().nullable().optional(),
  warehouse: z
    .object({
      id: z.string().uuid().nullable().optional(),
      code: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      isActive: z.boolean().nullable().optional(),
    })
    .optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
const siteWarehouseRoleCreateOpenApiSchema = siteWarehouseRoleCreateSchema.omit({
  organizationId: true,
  tenantId: true,
});
export const openApi = createWmsCrudOpenApi({
  resourceName: "Site warehouse role",
  pluralName: "Site warehouse roles",
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: {
    schema: siteWarehouseRoleCreateOpenApiSchema,
    description: "Assigns an active warehouse to a WMS site role.",
  },
  update: {
    schema: siteWarehouseRoleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Updates a site warehouse role.",
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a site warehouse role.",
  },
});
