import { z } from "zod";
import type { EntityManager } from "@mikro-orm/postgresql";
import { makeCrudRoute } from "@open-mercato/shared/lib/crud/factory";
import { CrudHttpError } from "@open-mercato/shared/lib/crud/errors";
import { extractAllCustomFieldEntries } from "@open-mercato/shared/lib/crud/custom-fields";
import { resolveTranslations } from "@open-mercato/shared/lib/i18n/server";
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductUnitConversion,
  CatalogProductVariant,
  CatalogProductTagAssignment,
} from "../../data/entities";
import type { CatalogProductType } from "../../data/types";
import {
  productCreateSchema,
  productUpdateSchema,
} from "../../data/validators";
import { parseScopedCommandInput, resolveCrudRecordId } from "../utils";
import { splitCustomFieldPayload } from "@open-mercato/shared/lib/crud/custom-fields";
import { E } from "#generated/entities.ids.generated";
import * as F from "#generated/entities/catalog_product";
import { sanitizeSearchTerm } from "../helpers";
import type { CrudCtx } from "@open-mercato/shared/lib/crud/factory";
import { buildScopedWhere } from "@open-mercato/shared/lib/api/crud";
import {
  resolvePriceChannelId,
  resolvePriceOfferId,
  resolvePriceVariantId,
  resolvePriceKindCode,
  type PricingContext,
  type PriceRow,
} from "../../lib/pricing";
import type { CatalogPricingService } from "../../services/catalogPricingService";
import { SalesChannel } from "@open-mercato/core/modules/sales/data/entities";
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from "../openapi";
import { findWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import { canonicalizeUnitCode, toUnitLookupKey } from "../../lib/unitCodes";
import {
  attachProductListOmnibusBlocks,
  type OmnibusProductListEntry,
} from "../../lib/omnibusProductListEnrichment";
import { omnibusBlockSchema, type OmnibusBlock } from "../../lib/omnibusTypes";
import {
  buildProductFilters,
  catalogProductFilterQuerySchema,
  parseIdList,
  scoreProductSearchRelevance,
  type CatalogProductFilterQuery,
} from "../../lib/productFilters";
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('catalog')
const rawBodySchema = z.object({}).passthrough();

const listSchema = catalogProductFilterQuerySchema;

type ProductsQuery = CatalogProductFilterQuery;

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ["catalog.products.view"] },
  POST: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  PUT: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  DELETE: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
};

export const metadata = routeMetadata;

export {
  buildProductFilters,
  parseIdList,
  scoreProductSearchRelevance,
} from "../../lib/productFilters";

export function buildPricingContext(
  query: ProductsQuery,
  channelFallback: string | null,
): PricingContext {
  const quantity = Number.isFinite(Number(query.quantity))
    ? Number(query.quantity)
    : 1;
  const parsedDate = query.priceDate ? new Date(query.priceDate) : new Date();
  const channelId = query.channelId ?? channelFallback ?? null;
  return {
    channelId,
    offerId: query.offerId ?? null,
    userId: query.userId ?? null,
    userGroupId: query.userGroupId ?? null,
    customerId: query.customerId ?? null,
    customerGroupId: query.customerGroupId ?? null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    date: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
  };
}

type ProductListItem = Record<string, unknown> & {
  id?: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  sku?: string | null;
  handle?: string | null;
  product_type?: CatalogProductType | null;
  primary_currency_code?: string | null;
  default_unit?: string | null;
  default_sales_unit?: string | null;
  default_sales_unit_quantity?: number | null;
  uom_rounding_scale?: number | null;
  uom_rounding_mode?: "half_up" | "down" | "up" | null;
  unit_price_enabled?: boolean | null;
  unit_price_reference_unit?: "kg" | "l" | "m2" | "m3" | "pc" | null;
  unit_price_base_quantity?: number | null;
  default_media_id?: string | null;
  default_media_url?: string | null;
  weight_value?: string | null;
  weightValue?: string | null;
  weight_unit?: string | null;
  weightUnit?: string | null;
  dimensions?: Record<string, unknown> | null;
  custom_fieldset_code?: string | null;
  option_schema_id?: string | null;
  offers?: Array<Record<string, unknown>>;
  channelIds?: string[];
  categories?: Array<Record<string, unknown>>;
  categoryIds?: string[];
  tags?: string[];
  omnibus?: OmnibusBlock;
};

async function decorateProductsAfterList(
  payload: { items?: ProductListItem[] },
  ctx: CrudCtx & { query: ProductsQuery },
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) return;
  const productIds = items
    .map((item) => (typeof item.id === "string" ? item.id : null))
    .filter((id): id is string => !!id);
  if (!productIds.length) return;
  try {
    const em = (ctx.container.resolve("em") as EntityManager).fork();
    const scope = {
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
    };
    const offers = await findWithDecryption(
      em,
      CatalogOffer,
      { product: { $in: productIds }, deletedAt: null, ...scope },
      { orderBy: { createdAt: "asc" } },
      scope,
    );
    const channelIds = Array.from(
      new Set(
        offers
          .map((offer) => offer.channelId)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );
    const channelLookup = new Map<
      string,
      { name?: string | null; code?: string | null }
    >();
    if (channelIds.length) {
      const scopedChannelsWhere = buildScopedWhere(
        { id: { $in: channelIds } },
        {
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          organizationIds: Array.isArray(ctx.organizationIds)
            ? ctx.organizationIds
            : undefined,
          tenantId: ctx.auth?.tenantId ?? null,
        },
      );
      const channels = await findWithDecryption(em, SalesChannel, scopedChannelsWhere, {
        fields: ["id", "name", "code"],
      });
      for (const channel of channels) {
        channelLookup.set(channel.id, {
          name: channel.name,
          code: channel.code ?? null,
        });
      }
    }
    const offersByProduct = new Map<string, Array<Record<string, unknown>>>();
    for (const offer of offers) {
      const productId =
        typeof offer.product === "string"
          ? offer.product
          : (offer.product?.id ?? null);
      if (!productId) continue;
      const channelInfo = channelLookup.get(offer.channelId);
      const entry = offersByProduct.get(productId) ?? [];
      entry.push({
        id: offer.id,
        channelId: offer.channelId,
        channelName: channelInfo?.name ?? null,
        channelCode: channelInfo?.code ?? null,
        title: offer.title,
        description: offer.description ?? null,
        isActive: offer.isActive,
        defaultMediaId: offer.defaultMediaId ?? null,
        defaultMediaUrl: offer.defaultMediaUrl ?? null,
        metadata: offer.metadata ?? null,
        updatedAt:
          offer.updatedAt instanceof Date
            ? offer.updatedAt.toISOString()
            : (typeof offer.updatedAt === "string" ? offer.updatedAt : null),
      });
      offersByProduct.set(productId, entry);
    }

    const categoryAssignments = await findWithDecryption(
      em,
      CatalogProductCategoryAssignment,
      { product: { $in: productIds }, ...scope },
      { populate: ["category"], orderBy: { position: "asc" } },
      scope,
    );
    const parentIds = new Set<string>();
    for (const assignment of categoryAssignments) {
      const category =
        typeof assignment.category === "string"
          ? null
          : (assignment.category ?? null);
      if (!category) continue;
      const parentId = category.parentId ?? null;
      if (parentId) parentIds.add(parentId);
    }
    const parentCategories = parentIds.size
      ? await findWithDecryption(
          em,
          CatalogProductCategory,
          { id: { $in: Array.from(parentIds) }, ...scope },
          { fields: ["id", "name"] },
          scope,
        )
      : [];
    const parentNameById = new Map<string, string | null>();
    for (const parent of parentCategories) {
      parentNameById.set(parent.id, parent.name ?? null);
    }
    const categoriesByProduct = new Map<
      string,
      Array<{
        id: string;
        name: string | null;
        treePath: string | null;
        parentId: string | null;
        parentName: string | null;
      }>
    >();
    for (const assignment of categoryAssignments) {
      const productId =
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null);
      if (!productId) continue;
      const category =
        typeof assignment.category === "string"
          ? null
          : (assignment.category ?? null);
      if (!category) continue;
      const parentId = category.parentId ?? null;
      const parentName = parentId
        ? (parentNameById.get(parentId) ?? null)
        : null;
      const bucket = categoriesByProduct.get(productId) ?? [];
      bucket.push({
        id: category.id,
        name: category.name ?? null,
        treePath: category.treePath ?? null,
        parentId,
        parentName,
      });
      categoriesByProduct.set(productId, bucket);
    }

    const tagAssignments = await findWithDecryption(
      em,
      CatalogProductTagAssignment,
      { product: { $in: productIds } },
      { populate: ["tag"] },
      {
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.auth?.orgId ?? null,
      },
    );
    const tagsByProduct = new Map<string, string[]>();
    for (const assignment of tagAssignments) {
      const productId =
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null);
      if (!productId) continue;
      const tag =
        typeof assignment.tag === "string" ? null : (assignment.tag ?? null);
      if (!tag) continue;
      const label =
        typeof tag.label === "string" && tag.label.trim().length
          ? tag.label
          : null;
      if (!label) continue;
      const bucket = tagsByProduct.get(productId) ?? [];
      bucket.push(label);
      tagsByProduct.set(productId, bucket);
    }

    const variants = await findWithDecryption(
      em,
      CatalogProductVariant,
      { product: { $in: productIds }, deletedAt: null, ...scope },
      { fields: ["id", "product"] },
      scope,
    );
    const variantToProduct = new Map<string, string>();
    for (const variant of variants) {
      const productId =
        typeof variant.product === "string"
          ? variant.product
          : (variant.product?.id ?? null);
      if (!productId) continue;
      variantToProduct.set(variant.id, productId);
    }
    const variantIds = Array.from(variantToProduct.keys());
    const priceWhere =
      variantIds.length > 0
        ? {
            $or: [
              { product: { $in: productIds } },
              { variant: { $in: variantIds } },
            ],
          }
        : { product: { $in: productIds } };
    const priceRows = await findWithDecryption<CatalogProductPrice>(
      em,
      CatalogProductPrice,
      { ...priceWhere, ...scope },
      { populate: ["offer", "variant", "product", "priceKind"] },
      scope,
    );
    const pricesByProduct = new Map<string, PriceRow[]>();
    for (const price of priceRows) {
      let productId: string | null = null;
      if (price.product) {
        productId =
          typeof price.product === "string"
            ? price.product
            : (price.product?.id ?? null);
      } else if (price.variant) {
        const variantId =
          typeof price.variant === "string" ? price.variant : price.variant.id;
        productId = variantToProduct.get(variantId) ?? null;
      }
      if (!productId) continue;
      const entry = pricesByProduct.get(productId) ?? [];
      entry.push(price);
      pricesByProduct.set(productId, entry);
    }

    const requestQuantityUnitKey = toUnitLookupKey(
      ctx.query.quantityUnit,
    );
    const conversionsByProduct = new Map<string, Map<string, number>>();
    const conversionOrganizationId =
      ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null;
    const conversionTenantId = ctx.auth?.tenantId ?? null;
    if (
      requestQuantityUnitKey &&
      productIds.length &&
      conversionOrganizationId &&
      conversionTenantId
    ) {
      const conversionRows = await findWithDecryption(
        em,
        CatalogProductUnitConversion,
        {
          product: { $in: productIds },
          organizationId: conversionOrganizationId,
          tenantId: conversionTenantId,
          deletedAt: null,
          isActive: true,
        },
        { fields: ["id", "product", "unitCode", "toBaseFactor"] },
        { organizationId: conversionOrganizationId, tenantId: conversionTenantId },
      );
      for (const row of conversionRows) {
        const productId =
          typeof row.product === "string"
            ? row.product
            : (row.product?.id ?? null);
        const unitKey = toUnitLookupKey(row.unitCode);
        const factor = Number(row.toBaseFactor);
        if (!productId || !unitKey || !Number.isFinite(factor) || factor <= 0)
          continue;
        const bucket =
          conversionsByProduct.get(productId) ?? new Map<string, number>();
        bucket.set(unitKey, factor);
        conversionsByProduct.set(productId, bucket);
      }
    }

    const channelFilterIds = parseIdList(ctx.query.channelIds);
    const channelContext =
      ctx.query.channelId ??
      (channelFilterIds.length === 1 ? channelFilterIds[0] : null);
    const pricingContext = buildPricingContext(ctx.query, channelContext);
    const pricingService = ctx.container.resolve<CatalogPricingService>(
      "catalogPricingService",
    );

    const pricingEntries: Array<{ rows: PriceRow[]; context: PricingContext } | null> = [];
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id : null;
      if (!id) {
        pricingEntries.push(null);
        continue;
      }
      const offerEntries = offersByProduct.get(id) ?? [];
      item.offers = offerEntries;
      const channelIds = Array.from(
        new Set(
          offerEntries
            .map((offer) =>
              typeof offer.channelId === "string" ? offer.channelId : null,
            )
            .filter((channelId): channelId is string => !!channelId),
        ),
      );
      item.channelIds = channelIds;
      const categories = categoriesByProduct.get(id) ?? [];
      item.categories = categories;
      item.categoryIds = categories.map((category) => category.id);
      item.tags = tagsByProduct.get(id) ?? [];
      if (item.is_quote_only === true) {
        item.pricing = null;
        pricingEntries.push(null);
        continue;
      }
      const priceCandidates = pricesByProduct.get(id) ?? [];
      const normalizedQuantityForPricing = (() => {
        if (!requestQuantityUnitKey) return pricingContext.quantity;
        const baseUnit = toUnitLookupKey(item.default_unit);
        if (!baseUnit || requestQuantityUnitKey === baseUnit)
          return pricingContext.quantity;
        const productConversions = conversionsByProduct.get(id);
        const factor = productConversions?.get(requestQuantityUnitKey) ?? null;
        if (!factor || !Number.isFinite(factor) || factor <= 0) {
          logger.debug('catalog.products invalid conversion factor', { productId: id, unit: requestQuantityUnitKey, factor });
          return pricingContext.quantity;
        }
        const normalized = pricingContext.quantity * factor;
        return Number.isFinite(normalized) && normalized > 0
          ? normalized
          : pricingContext.quantity;
      })();
      const channelScopedContext =
        pricingContext.channelId || channelIds.length !== 1
          ? pricingContext
          : { ...pricingContext, channelId: channelIds[0] };
      pricingEntries.push({
        rows: priceCandidates,
        context: { ...channelScopedContext, quantity: normalizedQuantityForPricing },
      });
    }

    const resolveInputs: Array<{ rows: PriceRow[]; context: PricingContext }> = [];
    const resolveIndices: number[] = [];
    for (let i = 0; i < pricingEntries.length; i++) {
      if (pricingEntries[i] !== null) {
        resolveInputs.push(pricingEntries[i]!);
        resolveIndices.push(i);
      }
    }
    const priceResults = await pricingService.resolvePriceMany(resolveInputs);

    const omnibusEntries: OmnibusProductListEntry[] = [];
    for (let i = 0; i < resolveIndices.length; i++) {
      const item = items[resolveIndices[i]];
      const best = priceResults[i];
      if (best) {
        if (typeof item.id === "string") {
          omnibusEntries.push({
            item,
            productId: item.id,
            candidates: resolveInputs[i].rows,
            best,
            context: resolveInputs[i].context,
          });
        }
        item.pricing = {
          kind: resolvePriceKindCode(best),
          price_kind_id:
            typeof best.priceKind === "string"
              ? best.priceKind
              : (best.priceKind?.id ?? null),
          price_kind_code: resolvePriceKindCode(best),
          currency_code: best.currencyCode,
          unit_price_net: best.unitPriceNet,
          unit_price_gross: best.unitPriceGross,
          min_quantity: best.minQuantity,
          max_quantity: best.maxQuantity ?? null,
          tax_rate: best.taxRate ?? null,
          tax_amount: best.taxAmount ?? null,
          scope: {
            variant_id: resolvePriceVariantId(best),
            offer_id: resolvePriceOfferId(best),
            channel_id: resolvePriceChannelId(best),
            user_id: best.userId ?? null,
            user_group_id: best.userGroupId ?? null,
            customer_id: best.customerId ?? null,
            customer_group_id: best.customerGroupId ?? null,
          },
        };
      } else {
        item.pricing = null;
      }
    }

    await attachProductListOmnibusBlocks({
      em,
      container: ctx.container,
      tenantId: ctx.auth?.tenantId ?? null,
      entries: omnibusEntries,
    });
  } catch (error) {
    logger.error('decorateProductsAfterList Failed to load unit conversions', { err: error });
  }

  const searchTerm = ctx.query.search ? sanitizeSearchTerm(ctx.query.search) : null;
  if (searchTerm && !ctx.query.sortField && Array.isArray(payload.items)) {
    const needle = searchTerm.toLowerCase();
    payload.items.sort((a, b) => {
      const scoreA = scoreProductSearchRelevance(needle, a.title, a.sku);
      const scoreB = scoreProductSearchRelevance(needle, b.title, b.sku);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProduct,
    idField: "id",
    orgField: "organizationId",
    tenantField: "tenantId",
    softDeleteField: "deletedAt",
  },
  indexer: {
    entityType: E.catalog.catalog_product,
  },
  enrichers: {
    entityId: E.catalog.catalog_product,
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product,
    fields: [
      F.id,
      F.title,
      F.subtitle,
      F.description,
      F.sku,
      F.handle,
      "tax_rate_id",
      "tax_rate",
      F.product_type,
      F.status_entry_id,
      F.primary_currency_code,
      F.default_unit,
      "default_sales_unit",
      "default_sales_unit_quantity",
      "uom_rounding_scale",
      "uom_rounding_mode",
      "unit_price_enabled",
      "unit_price_reference_unit",
      "unit_price_base_quantity",
      F.default_media_id,
      F.default_media_url,
      F.weight_value,
      F.weight_unit,
      F.dimensions,
      F.is_configurable,
      F.is_active,
      "country_of_origin_code",
      "pkwiu_code",
      "cn_code",
      "hs_code",
      "tax_classification_code",
      "gtu_codes",
      "age_min",
      "is_excise_good",
      "excise_category",
      "requires_prescription",
      "hazmat_class",
      "un_number",
      "hazmat_packing_group",
      "contains_lithium_battery",
      "launch_at",
      "end_of_life_at",
      "available_from",
      "available_until",
      "min_order_qty",
      "max_order_qty",
      "order_qty_increment",
      "requires_shipping",
      "is_quote_only",
      "seo_title",
      "seo_description",
      "canonical_url",
      F.metadata,
      "custom_fieldset_code",
      "option_schema_id",
      F.created_at,
      F.updated_at,
    ],
    decorateCustomFields: { entityIds: [E.catalog.catalog_product] },
    sortFieldMap: {
      title: F.title,
      sku: F.sku,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: buildProductFilters,
    transformItem: (item: ProductListItem | null | undefined) => {
      if (!item) return item;
      const normalized = { ...item };
      const cfEntries = extractAllCustomFieldEntries(item);
      for (const key of Object.keys(normalized)) {
        if (key.startsWith("cf:")) {
          delete normalized[key];
        }
      }
      const defaultUnit = canonicalizeUnitCode(normalized.default_unit) ?? null;
      const defaultSalesUnit =
        canonicalizeUnitCode(normalized.default_sales_unit) ?? null;
      const unitPriceReferenceUnit =
        canonicalizeUnitCode(normalized.unit_price_reference_unit) ?? null;
      return {
        ...normalized,
        default_unit: defaultUnit,
        default_sales_unit: defaultSalesUnit,
        unit_price_reference_unit: unitPriceReferenceUnit,
        ...cfEntries,
        unit_price: {
          enabled: Boolean(normalized.unit_price_enabled),
          reference_unit: unitPriceReferenceUnit,
          base_quantity: normalized.unit_price_base_quantity ?? null,
        },
      };
    },
  },
  hooks: {
    afterList: decorateProductsAfterList,
  },
  actions: {
    create: {
      commandId: "catalog.products.create",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        const parsed = parseScopedCommandInput(
          productCreateSchema,
          raw ?? {},
          ctx,
          translate,
        );
        const { base, custom } = splitCustomFieldPayload(parsed);
        return Object.keys(custom).length
          ? { ...base, customFields: custom }
          : base;
      },
      response: ({ result }) => ({
        id: result?.productId ?? result?.id ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: "catalog.products.update",
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations();
        const parsed = parseScopedCommandInput(
          productUpdateSchema,
          raw ?? {},
          ctx,
          translate,
        );
        const { base, custom } = splitCustomFieldPayload(parsed);
        return Object.keys(custom).length
          ? { ...base, customFields: custom }
          : base;
      },
      response: ({ result }) => ({
        ok: true,
        updatedAt: result?.updatedAt ?? null,
      }),
    },
    delete: {
      commandId: "catalog.products.delete",
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations();
        const id = resolveCrudRecordId(parsed, ctx, translate);
        if (!id)
          throw new CrudHttpError(400, {
            error: translate(
              "catalog.errors.id_required",
              "Product id is required.",
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

const productListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  handle: z.string().nullable().optional(),
  product_type: z.string().nullable().optional(),
  status_entry_id: z.string().uuid().nullable().optional(),
  primary_currency_code: z.string().nullable().optional(),
  default_unit: z.string().nullable().optional(),
  default_sales_unit: z.string().nullable().optional(),
  default_sales_unit_quantity: z.number().nullable().optional(),
  uom_rounding_scale: z.number().nullable().optional(),
  uom_rounding_mode: z.enum(["half_up", "down", "up"]).nullable().optional(),
  unit_price_enabled: z.boolean().nullable().optional(),
  unit_price_reference_unit: z
    .enum(["kg", "l", "m2", "m3", "pc"])
    .nullable()
    .optional(),
  unit_price_base_quantity: z.number().nullable().optional(),
  unit_price: z
    .object({
      enabled: z.boolean(),
      reference_unit: z.enum(["kg", "l", "m2", "m3", "pc"]).nullable(),
      base_quantity: z.number().nullable(),
    })
    .optional(),
  default_media_id: z.string().uuid().nullable().optional(),
  default_media_url: z.string().nullable().optional(),
  weight_value: z.number().nullable().optional(),
  weight_unit: z.string().nullable().optional(),
  dimensions: z.record(z.string(), z.unknown()).nullable().optional(),
  is_configurable: z.boolean().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  country_of_origin_code: z.string().nullable().optional(),
  pkwiu_code: z.string().nullable().optional(),
  cn_code: z.string().nullable().optional(),
  hs_code: z.string().nullable().optional(),
  tax_classification_code: z.string().nullable().optional(),
  gtu_codes: z.array(z.string()).nullable().optional(),
  age_min: z.number().nullable().optional(),
  is_excise_good: z.boolean().nullable().optional(),
  excise_category: z.string().nullable().optional(),
  requires_prescription: z.boolean().nullable().optional(),
  hazmat_class: z.string().nullable().optional(),
  un_number: z.string().nullable().optional(),
  hazmat_packing_group: z.string().nullable().optional(),
  contains_lithium_battery: z.boolean().nullable().optional(),
  launch_at: z.string().nullable().optional(),
  end_of_life_at: z.string().nullable().optional(),
  available_from: z.string().nullable().optional(),
  available_until: z.string().nullable().optional(),
  min_order_qty: z.number().nullable().optional(),
  max_order_qty: z.number().nullable().optional(),
  order_qty_increment: z.number().nullable().optional(),
  requires_shipping: z.boolean().nullable().optional(),
  is_quote_only: z.boolean().nullable().optional(),
  seo_title: z.string().nullable().optional(),
  seo_description: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  custom_fieldset_code: z.string().nullable().optional(),
  option_schema_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  offers: z.array(z.record(z.string(), z.unknown())).optional(),
  channelIds: z.array(z.string()).optional(),
  categories: z.array(z.record(z.string(), z.unknown())).optional(),
  categoryIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  pricing: z.record(z.string(), z.unknown()).nullable().optional(),
  omnibus: omnibusBlockSchema
    .optional()
    .describe(
      "EU Omnibus reference-price block for the presented price. Present only when Omnibus is enabled for the tenant and the product has a resolved price.",
    ),
});

export const openApi = createCatalogCrudOpenApi({
  resourceName: "Product",
  pluralName: "Products",
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(productListItemSchema),
  create: {
    schema: productCreateSchema,
    description: "Creates a new product in the catalog.",
  },
  update: {
    schema: productUpdateSchema,
    responseSchema: defaultOkResponseSchema.extend({
      updatedAt: z.string().nullable().optional(),
    }),
    description: "Updates an existing product by id.",
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a product by id.",
  },
});
