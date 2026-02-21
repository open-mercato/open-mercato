import { z } from "zod";
import { makeCrudRoute } from "@open-mercato/shared/lib/crud/factory";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import { CatalogProductUnitConversion } from "../../data/entities";
import {
  productUnitConversionCreateSchema,
  productUnitConversionUpdateSchema,
  productUnitConversionDeleteSchema,
} from "../../data/validators";
import { parseScopedCommandInput } from "../utils";
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
} from "../openapi";
import { canonicalizeUnitCode } from "../../lib/unitCodes";

const rawBodySchema = z.object({}).passthrough();

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    unitCode: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .passthrough();

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ["catalog.products.view"] },
  POST: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  PUT: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  DELETE: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
};

export const metadata = routeMetadata;

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProductUnitConversion,
    idField: "id",
    orgField: "organizationId",
    tenantField: "tenantId",
    softDeleteField: "deletedAt",
  },
  indexer: {
    entityType: "catalog:catalog_product_unit_conversion",
  },
  list: {
    schema: listSchema,
    entityId: "catalog:catalog_product_unit_conversion",
    fields: [
      "id",
      "product_id",
      "organization_id",
      "tenant_id",
      "unit_code",
      "to_base_factor",
      "sort_order",
      "is_active",
      "metadata",
      "created_at",
      "updated_at",
    ],
    sortFieldMap: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      sortOrder: "sort_order",
      unitCode: "unit_code",
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {};
      if (query.id) filters.id = { $eq: query.id };
      if (query.productId) filters.product_id = { $eq: query.productId };
      const unitCode = canonicalizeUnitCode(query.unitCode);
      if (unitCode) {
        filters.unit_code = { $eq: unitCode };
      }
      if (typeof query.isActive === "boolean") {
        filters.is_active = query.isActive;
      }
      return filters;
    },
    transformItem: (item: Record<string, unknown> | null | undefined) => {
      if (!item) return item;
      const unitCode = canonicalizeUnitCode(
        (item as any).unit_code ?? (item as any).unitCode,
      );
      return {
        ...item,
        unit_code: unitCode,
        unitCode,
      };
    },
  },
  actions: {
    create: {
      commandId: "catalog.product-unit-conversions.create",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return parseScopedCommandInput(
          productUnitConversionCreateSchema,
          raw ?? {},
          ctx,
          translate,
        );
      },
      response: ({ result }) => ({ id: result?.conversionId ?? null }),
      status: 201,
    },
    update: {
      commandId: "catalog.product-unit-conversions.update",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return parseScopedCommandInput(
          productUnitConversionUpdateSchema,
          raw ?? {},
          ctx,
          translate,
        );
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: "catalog.product-unit-conversions.delete",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        const parsed = parseScopedCommandInput(
          productUnitConversionDeleteSchema,
          raw ?? {},
          ctx,
          translate,
        );
        if (!parsed.id) {
          throw new CrudHttpError(400, {
            error: translate(
              "catalog.errors.id_required",
              "Record identifier is required.",
            ),
          });
        }
        return parsed;
      },
      response: () => ({ ok: true }),
    },
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;

const conversionListItemSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  unit_code: z.string(),
  to_base_factor: z.number(),
  sort_order: z.number().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const openApi = createCatalogCrudOpenApi({
  resourceName: "Product unit conversion",
  pluralName: "Product unit conversions",
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(conversionListItemSchema),
  create: {
    schema: productUnitConversionCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description: "Creates a product unit conversion.",
  },
  update: {
    schema: productUnitConversionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Updates an existing product unit conversion by id.",
  },
  del: {
    schema: productUnitConversionDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a product unit conversion by id.",
  },
});
