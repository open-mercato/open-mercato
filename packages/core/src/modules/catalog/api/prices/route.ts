import { z } from "zod";
import type { EntityManager } from "@mikro-orm/postgresql";
import { makeCrudRoute } from "@open-mercato/shared/lib/crud/factory";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import {
  buildCustomFieldFiltersFromQuery,
  extractAllCustomFieldEntries,
} from "@open-mercato/shared/lib/crud/custom-fields";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import {
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductUnitConversion,
  CatalogProductVariant,
} from "../../data/entities";
import { priceCreateSchema, priceUpdateSchema } from "../../data/validators";
import { parseScopedCommandInput, resolveCrudRecordId } from "../utils";
import { E } from "#generated/entities.ids.generated";
import * as FP from "#generated/entities/catalog_product_price";
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from "../openapi";
import { toUnitLookupKey } from "../../lib/unitCodes";
import {
  findWithDecryption,
  findOneWithDecryption,
} from "@open-mercato/shared/lib/encryption/find";

const rawBodySchema = z.object({}).passthrough();

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    productId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    offerId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    currencyCode: z.string().optional(),
    priceKindId: z.string().uuid().optional(),
    kind: z.string().optional(),
    userId: z.string().uuid().optional(),
    userGroupId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    customerGroupId: z.string().uuid().optional(),
    quantity: z.coerce.number().min(1).max(100000).optional(),
    quantityUnit: z.string().trim().max(50).optional(),
    withDeleted: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .passthrough();

type PriceQuery = z.infer<typeof listSchema>;

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ["catalog.products.view"] },
  POST: { requireAuth: true, requireFeatures: ["catalog.pricing.manage"] },
  PUT: { requireAuth: true, requireFeatures: ["catalog.pricing.manage"] },
  DELETE: { requireAuth: true, requireFeatures: ["catalog.pricing.manage"] },
};

export const metadata = routeMetadata;

async function resolveNormalizedQuantityForFilter(params: {
  em: EntityManager;
  organizationId: string | null;
  tenantId: string | null;
  productId?: string;
  variantId?: string;
  quantity: number;
  quantityUnit?: string;
}): Promise<number> {
  const quantity = params.quantity;
  const quantityUnitKey = toUnitLookupKey(params.quantityUnit);
  if ((!params.productId && !params.variantId) || !quantityUnitKey)
    return quantity;
  if (!params.organizationId || !params.tenantId) return quantity;
  let targetProductId = params.productId;
  if (!targetProductId && params.variantId) {
    const variant = await findOneWithDecryption(
      params.em,
      CatalogProductVariant,
      {
        id: params.variantId,
        organizationId: params.organizationId,
        tenantId: params.tenantId,
        deletedAt: null,
      },
      { fields: ["id", "product"] },
    );
    if (variant) {
      targetProductId =
        typeof variant.product === "string"
          ? variant.product
          : (variant.product?.id ?? null);
    }
  }
  if (!targetProductId) return quantity;
  const product = await findOneWithDecryption(
    params.em,
    CatalogProduct,
    {
      id: targetProductId,
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      deletedAt: null,
    },
    { fields: ["id", "defaultUnit"] },
  );
  if (!product) return quantity;
  const baseUnitKey = toUnitLookupKey(product.defaultUnit);
  if (!baseUnitKey || baseUnitKey === quantityUnitKey) return quantity;
  const conversions = await findWithDecryption(
    params.em,
    CatalogProductUnitConversion,
    {
      product: product.id,
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      isActive: true,
      deletedAt: null,
    },
    { fields: ["id", "unitCode", "toBaseFactor"] },
  );
  const conversion = conversions.find(
    (entry) => toUnitLookupKey(entry.unitCode) === quantityUnitKey,
  );
  if (!conversion) return quantity;
  const factor = Number(conversion.toBaseFactor);
  if (!Number.isFinite(factor) || factor <= 0) return quantity;
  const normalized = quantity * factor;
  return Number.isFinite(normalized) && normalized > 0 ? normalized : quantity;
}

export async function buildPriceFilters(
  query: PriceQuery,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {};
  if (query.productId) {
    filters.product_id = { $eq: query.productId };
  }
  if (query.variantId) {
    filters.variant_id = { $eq: query.variantId };
  }
  if (query.offerId) {
    filters.offer_id = { $eq: query.offerId };
  }
  if (query.channelId) {
    filters.channel_id = { $eq: query.channelId };
  }
  if (query.currencyCode) {
    filters.currency_code = { $eq: query.currencyCode.trim().toUpperCase() };
  }
  if (query.priceKindId) {
    filters.price_kind_id = { $eq: query.priceKindId };
  }
  if (query.kind) {
    filters.kind = { $eq: query.kind };
  }
  if (query.userId) filters.user_id = { $eq: query.userId };
  if (query.userGroupId) filters.user_group_id = { $eq: query.userGroupId };
  if (query.customerId) filters.customer_id = { $eq: query.customerId };
  if (query.customerGroupId)
    filters.customer_group_id = { $eq: query.customerGroupId };
  return filters;
}

let cachedNormalizedQuantity: number | null = null;

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProductPrice,
    idField: "id",
    orgField: "organizationId",
    tenantField: "tenantId",
    softDeleteField: null,
  },
  indexer: {
    entityType: E.catalog.catalog_product_price,
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product_price,
    fields: [
      FP.id,
      "product_id",
      "variant_id",
      "offer_id",
      FP.currency_code,
      "price_kind_id",
      FP.kind,
      FP.min_quantity,
      FP.max_quantity,
      FP.unit_price_net,
      FP.unit_price_gross,
      FP.tax_rate,
      FP.tax_amount,
      FP.channel_id,
      FP.user_id,
      FP.user_group_id,
      FP.customer_id,
      FP.customer_group_id,
      FP.metadata,
      FP.starts_at,
      FP.ends_at,
      FP.created_at,
      FP.updated_at,
    ],
    sortFieldMap: {
      currencyCode: FP.currency_code,
      priceKindId: "price_kind_id",
      kind: FP.kind,
      minQuantity: FP.min_quantity,
      createdAt: FP.created_at,
      updatedAt: FP.updated_at,
    },
    buildFilters: async (query, ctx) => {
      cachedNormalizedQuantity = null;
      const filters = await buildPriceFilters(query);
      const tenantId = ctx.auth?.tenantId ?? null;
      const organizationId =
        ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null;
      const em = ctx.container.resolve("em") as EntityManager;
      try {
        const cfFilters = await buildCustomFieldFiltersFromQuery({
          entityIds: [E.catalog.catalog_product_price],
          query,
          em,
          tenantId,
        });
        Object.assign(filters, cfFilters);
      } catch (err) {
        // Custom field filter parsing may fail for non-existent or misconfigured fields.
        if (process.env.NODE_ENV === 'development') console.warn('[catalog:prices] custom field filter error', err);
      }
      if (
        typeof query.quantity === "number" &&
        Number.isFinite(query.quantity) &&
        query.quantity > 0
      ) {
        const normalizedQuantity = await resolveNormalizedQuantityForFilter({
          em,
          organizationId,
          tenantId,
          productId: query.productId,
          variantId: query.variantId,
          quantity: query.quantity,
          quantityUnit: query.quantityUnit,
        });
        cachedNormalizedQuantity = normalizedQuantity;
        filters.min_quantity = { $lte: normalizedQuantity };
      }
      return filters;
    },
    transformItem: (item: Record<string, unknown> | null | undefined) => {
      if (!item) return item;
      const normalized = { ...item };
      const cfEntries = extractAllCustomFieldEntries(item);
      for (const key of Object.keys(normalized)) {
        if (key.startsWith("cf:")) delete normalized[key];
      }
      return { ...normalized, ...cfEntries };
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const query = ctx.query as PriceQuery;
      if (!Array.isArray(payload.items)) return;
      if (
        typeof query.quantity !== "number" ||
        !Number.isFinite(query.quantity) ||
        query.quantity <= 0
      )
        return;
      if (cachedNormalizedQuantity === null) return;
      const normalizedQuantity = cachedNormalizedQuantity;
      payload.items = payload.items.filter((item: unknown) => {
        const record = item as Record<string, unknown>;
        const rawMin = record.min_quantity ?? record.minQuantity;
        const rawMax = record.max_quantity ?? record.maxQuantity;
        const minQuantity = Number(rawMin ?? 0);
        const maxQuantity =
          rawMax === null || rawMax === undefined || rawMax === ""
            ? null
            : Number(rawMax);
        if (!Number.isFinite(minQuantity)) return false;
        if (maxQuantity !== null && !Number.isFinite(maxQuantity)) return false;
        return (
          minQuantity <= normalizedQuantity &&
          (maxQuantity === null || maxQuantity >= normalizedQuantity)
        );
      });
      payload.total = payload.items.length;
    },
  },
  actions: {
    create: {
      commandId: "catalog.prices.create",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return parseScopedCommandInput(
          priceCreateSchema,
          raw ?? {},
          ctx,
          translate,
        );
      },
      response: ({ result }) => ({ id: result?.priceId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: "catalog.prices.update",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        return parseScopedCommandInput(
          priceUpdateSchema,
          raw ?? {},
          ctx,
          translate,
        );
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: "catalog.prices.delete",
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations();
        const id = resolveCrudRecordId(parsed, ctx, translate);
        if (!id)
          throw new CrudHttpError(400, {
            error: translate(
              "catalog.errors.id_required",
              "Price id is required.",
            ),
          });
        return { id };
      },
      response: () => ({ ok: true }),
    },
  },
});

export const GET = crud.GET;
export const POST = crud.POST;
export const PUT = crud.PUT;
export const DELETE = crud.DELETE;

const priceListItemSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid().nullable().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  offer_id: z.string().uuid().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  price_kind_id: z.string().uuid().nullable().optional(),
  kind: z.string().nullable().optional(),
  min_quantity: z.number().nullable().optional(),
  max_quantity: z.number().nullable().optional(),
  unit_price_net: z.number().nullable().optional(),
  unit_price_gross: z.number().nullable().optional(),
  tax_rate: z.number().nullable().optional(),
  tax_amount: z.number().nullable().optional(),
  channel_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  user_group_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  customer_group_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const openApi = createCatalogCrudOpenApi({
  resourceName: "Price",
  pluralName: "Prices",
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(priceListItemSchema),
  create: {
    schema: priceCreateSchema,
    description: "Creates a new price entry for a product or variant.",
  },
  update: {
    schema: priceUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: "Updates an existing price by id.",
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a price by id.",
  },
});
