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
  CatalogOffer,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductUnitConversion,
  CatalogProductVariant,
  CatalogProductTagAssignment,
} from "../../data/entities";
import { CATALOG_PRODUCT_TYPES } from "../../data/types";
import type { CatalogProductType } from "../../data/types";
import {
  productCreateSchema,
  productUpdateSchema,
} from "../../data/validators";
import { parseScopedCommandInput, resolveCrudRecordId } from "../utils";
import { splitCustomFieldPayload } from "@open-mercato/shared/lib/crud/custom-fields";
import { E } from "#generated/entities.ids.generated";
import * as F from "#generated/entities/catalog_product";
import { parseBooleanFlag, sanitizeSearchTerm } from "../helpers";
import { escapeLikePattern } from "@open-mercato/shared/lib/db/escapeLikePattern";
import type { CrudCtx } from "@open-mercato/shared/lib/crud/factory";
import { buildScopedWhere } from "@open-mercato/shared/lib/api/crud";
import {
  resolvePriceChannelId,
  resolvePriceOfferId,
  resolvePriceVariantId,
  resolvePriceKindCode,
  type PricingContext,
  type PriceRow,
} from '../../lib/pricing'
import type { CatalogPricingService } from '../../services/catalogPricingService'
import { detectPersonalization } from '../../services/catalogPricingService'
import type { CatalogOmnibusService } from '../../services/catalogOmnibusService'
import { fieldsetCodeRegex } from '@open-mercato/core/modules/entities/data/validators'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from "../openapi";
import { findWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import { canonicalizeUnitCode, toUnitLookupKey } from "../../lib/unitCodes";
const rawBodySchema = z.object({}).passthrough();

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    status: z.string().optional(),
    isActive: z.string().optional(),
    configurable: z.string().optional(),
    productType: z.enum(CATALOG_PRODUCT_TYPES).optional(),
    channelIds: z.string().optional(),
    channelId: z.string().uuid().optional(),
    categoryIds: z.string().optional(),
    tagIds: z.string().optional(),
    offerId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    userGroupId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    customerGroupId: z.string().uuid().optional(),
    quantity: z.coerce.number().min(1).max(100000).optional(),
    quantityUnit: z.string().trim().max(50).optional(),
    priceDate: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    withDeleted: z.coerce.boolean().optional(),
    customFieldset: z.string().regex(fieldsetCodeRegex).optional(),
  })
  .passthrough();

type ProductsQuery = z.infer<typeof listSchema>;

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ["catalog.products.view"] },
  POST: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  PUT: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
  DELETE: { requireAuth: true, requireFeatures: ["catalog.products.manage"] },
};

export const metadata = routeMetadata;

export function parseIdList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_REGEX.test(value));
}

export async function buildProductFilters(
  query: ProductsQuery,
  ctx: CrudCtx,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {};
  const em = (ctx.container.resolve("em") as EntityManager).fork();
  const restrictedProductIds: { value: Set<string> | null } = { value: null };

  const intersectProductIds = (ids: string[]) => {
    const normalized = ids.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    const current = new Set(normalized);
    if (!current.size) {
      restrictedProductIds.value = new Set();
      return;
    }
    if (!restrictedProductIds.value) {
      restrictedProductIds.value = current;
      return;
    }
    restrictedProductIds.value = new Set(
      Array.from(restrictedProductIds.value).filter((id) => current.has(id)),
    );
  };

  const applyRestrictedProducts = () => {
    if (!restrictedProductIds.value) return;
    if (restrictedProductIds.value.size === 0) {
      filters.id = { $eq: "00000000-0000-0000-0000-000000000000" };
      return;
    }
    const ids = Array.from(restrictedProductIds.value);
    const existing = filters.id as Record<string, unknown> | undefined;
    if (existing && typeof existing === "object") {
      if (
        "$eq" in existing &&
        typeof (existing as { $eq?: unknown }).$eq === "string"
      ) {
        const target = (existing as { $eq: string }).$eq;
        if (!restrictedProductIds.value.has(target)) {
          filters.id = { $eq: "00000000-0000-0000-0000-000000000000" };
        }
        return;
      }
      if (
        "$in" in existing &&
        Array.isArray((existing as { $in?: unknown }).$in)
      ) {
        const subset = (existing as { $in: string[] }).$in.filter((id) =>
          restrictedProductIds.value!.has(id),
        );
        filters.id = subset.length
          ? { $in: subset }
          : { $eq: "00000000-0000-0000-0000-000000000000" };
        return;
      }
    }
    filters.id = ids.length === 1 ? { $eq: ids[0] } : { $in: ids };
  };
  if (query.id) {
    filters.id = { $eq: query.id };
  }
  const term = sanitizeSearchTerm(query.search);
  if (term) {
    const like = `%${escapeLikePattern(term)}%`;
    filters.$or = [
      { title: { $ilike: like } },
      { subtitle: { $ilike: like } },
      { sku: { $ilike: like } },
      { handle: { $ilike: like } },
      { description: { $ilike: like } },
    ];
  }
  if (query.status && query.status.trim()) {
    filters.status_entry_id = { $eq: query.status.trim() };
  }
  const active = parseBooleanFlag(query.isActive);
  if (active !== undefined) {
    filters.is_active = active;
  }
  const configurable = parseBooleanFlag(query.configurable);
  if (configurable !== undefined) {
    filters.is_configurable = configurable;
  }
  if (query.productType) {
    filters.product_type = { $eq: query.productType };
  }
  const scope = {
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    tenantId: ctx.auth?.tenantId ?? null,
  };

  const channelFilterIds = parseIdList(query.channelIds);
  if (channelFilterIds.length) {
    const offerRows = await findWithDecryption(
      em,
      CatalogOffer,
      {
        channelId: { $in: channelFilterIds },
        deletedAt: null,
        ...scope,
      },
      { fields: ["id", "product"] },
      scope,
    );
    const productIds = offerRows
      .map((offer) =>
        typeof offer.product === "string"
          ? offer.product
          : (offer.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
    intersectProductIds(productIds);
  }

  const categoryFilterIds = parseIdList(query.categoryIds);
  if (categoryFilterIds.length) {
    const assignments = await findWithDecryption(
      em,
      CatalogProductCategoryAssignment,
      { category: { $in: categoryFilterIds }, ...scope },
      { fields: ["id", "product"] },
      scope,
    );
    const productIds = assignments
      .map((assignment) =>
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
    intersectProductIds(productIds);
  }

  const tagFilterIds = parseIdList(query.tagIds);
  if (tagFilterIds.length) {
    const assignments = await findWithDecryption(
      em,
      CatalogProductTagAssignment,
      { tag: { $in: tagFilterIds }, ...scope },
      { fields: ["id", "product"] },
      scope,
    );
    const productIds = assignments
      .map((assignment) =>
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
    intersectProductIds(productIds);
  }
  const customFieldset =
    typeof query.customFieldset === "string" &&
    query.customFieldset.trim().length
      ? query.customFieldset.trim()
      : null;
  const tenantId = ctx.auth?.tenantId ?? null;
  try {
    const scopedEm = ctx.container.resolve("em") as EntityManager;
    const cfFilters = await buildCustomFieldFiltersFromQuery({
      entityIds: [E.catalog.catalog_product],
      query,
      em: scopedEm,
      tenantId,
      fieldset: customFieldset ?? undefined,
    });
    Object.assign(filters, cfFilters);
  } catch (err) {
    // Custom field filter parsing may fail for non-existent or misconfigured fields.
    // Fall back to base filters to avoid blocking the product listing.
    if (process.env.NODE_ENV === 'development') console.warn('[catalog:products] custom field filter error', err);
  }
  applyRestrictedProducts();
  return filters;
}

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
  id?: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  sku?: string | null
  handle?: string | null
  product_type?: CatalogProductType | null
  primary_currency_code?: string | null
  default_unit?: string | null
  default_sales_unit?: string | null
  default_sales_unit_quantity?: number | null
  uom_rounding_scale?: number | null
  uom_rounding_mode?: 'half_up' | 'down' | 'up' | null
  unit_price_enabled?: boolean | null
  unit_price_reference_unit?: 'kg' | 'l' | 'm2' | 'm3' | 'pc' | null
  unit_price_base_quantity?: number | null
  default_media_id?: string | null
  default_media_url?: string | null
  weight_value?: string | null
  weightValue?: string | null
  weight_unit?: string | null
  weightUnit?: string | null
  dimensions?: Record<string, unknown> | null
  custom_fieldset_code?: string | null
  option_schema_id?: string | null
  omnibusExempt?: boolean | null
  firstListedAt?: Date | string | null
  offers?: Array<Record<string, unknown>>
  channelIds?: string[]
  categories?: Array<Record<string, unknown>>
  categoryIds?: string[]
  tags?: string[]
}

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
    )
    const variantToProduct = new Map<string, string>()
    for (const variant of variants) {
      const productId =
        typeof variant.product === "string"
          ? variant.product
          : (variant.product?.id ?? null)
      if (!productId) continue
      variantToProduct.set(variant.id, productId)
    }
    const variantIds = Array.from(variantToProduct.keys())
    const priceWhere =
      variantIds.length > 0
        ? {
            $or: [
              { product: { $in: productIds } },
              { variant: { $in: variantIds } },
            ],
          }
        : { product: { $in: productIds } }
    const priceRows = await findWithDecryption(
      em,
      CatalogProductPrice,
      { ...priceWhere, ...scope },
      { populate: ["offer", "variant", "product", "priceKind"] },
      scope,
    )
    const pricesByProduct = new Map<string, PriceRow[]>()
    for (const price of priceRows) {
      let productId: string | null = null
      if (price.product) {
        productId =
          typeof price.product === "string"
            ? price.product
            : (price.product?.id ?? null)
      } else if (price.variant) {
        const variantId =
          typeof price.variant === "string" ? price.variant : price.variant.id
        productId = variantToProduct.get(variantId) ?? null
      }
      if (!productId) continue
      const entry = pricesByProduct.get(productId) ?? []
      entry.push(price)
      pricesByProduct.set(productId, entry)
    }

    const requestQuantityUnitKey = toUnitLookupKey(ctx.query.quantityUnit)
    const conversionsByProduct = new Map<string, Map<string, number>>()
    const conversionOrganizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    const conversionTenantId = ctx.auth?.tenantId ?? null
    if (requestQuantityUnitKey && productIds.length && conversionOrganizationId && conversionTenantId) {
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
      )
      for (const row of conversionRows) {
        const productId =
          typeof row.product === "string"
            ? row.product
            : (row.product?.id ?? null)
        const unitKey = toUnitLookupKey(row.unitCode)
        const factor = Number(row.toBaseFactor)
        if (!productId || !unitKey || !Number.isFinite(factor) || factor <= 0) continue
        const bucket = conversionsByProduct.get(productId) ?? new Map<string, number>()
        bucket.set(unitKey, factor)
        conversionsByProduct.set(productId, bucket)
      }
    }

    const channelFilterIds = parseIdList(ctx.query.channelIds);
    const channelContext =
      ctx.query.channelId ??
      (channelFilterIds.length === 1 ? channelFilterIds[0] : null);
    const pricingContext = buildPricingContext(ctx.query, channelContext);
    const pricingService = ctx.container.resolve<CatalogPricingService>('catalogPricingService')
    const catalogOmnibusService = ctx.container.resolve<CatalogOmnibusService>('catalogOmnibusService')
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null

    for (const item of items) {
      const id = typeof item.id === "string" ? item.id : null;
      if (!id) continue;
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
      const priceCandidates = pricesByProduct.get(id) ?? [];
      const normalizedQuantityForPricing = (() => {
        if (!requestQuantityUnitKey) return pricingContext.quantity;
        const baseUnit = toUnitLookupKey(item.default_unit);
        if (!baseUnit || requestQuantityUnitKey === baseUnit)
          return pricingContext.quantity;
        const productConversions = conversionsByProduct.get(id);
        const factor = productConversions?.get(requestQuantityUnitKey) ?? null;
        if (!factor || !Number.isFinite(factor) || factor <= 0) {
          if (process.env.NODE_ENV === 'development') console.warn(`[catalog.products] Invalid conversion factor for product=${id} unit=${requestQuantityUnitKey} factor=${factor}`);
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
      const best = await pricingService.resolvePrice(priceCandidates, {
        ...channelScopedContext,
        quantity: normalizedQuantityForPricing,
      });
      if (best) {
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
          is_personalized: detectPersonalization(best).isPersonalized,
          personalization_reason: detectPersonalization(best).personalizationReason,
        }
        const resolvedPriceKindId = typeof best.priceKind === 'string' ? best.priceKind : best.priceKind?.id ?? null
        const priceKindIsPromotion = typeof best.priceKind !== 'string' && (best.priceKind?.isPromotion ?? false)
        if (resolvedPriceKindId && best.currencyCode && tenantId && organizationId) {
          const omnibusCtx = {
            tenantId,
            organizationId,
            productId: id,
            variantId: resolvePriceVariantId(best) ?? null,
            offerId: resolvePriceOfferId(best) ?? null,
            priceKindId: resolvedPriceKindId,
            currencyCode: best.currencyCode,
            channelId: resolvePriceChannelId(best) ?? channelScopedContext.channelId ?? null,
            isStorefront: false,
            omnibusExempt: typeof item.omnibusExempt === 'boolean' ? item.omnibusExempt : null,
            firstListedAt: item.firstListedAt instanceof Date ? item.firstListedAt : (item.firstListedAt ? new Date(item.firstListedAt as string | number) : null),
          }
          item.omnibus = await catalogOmnibusService.resolveOmnibusBlock(em, omnibusCtx, null, priceKindIsPromotion)
        } else {
          item.omnibus = null
        }
      } else {
        item.pricing = null
        item.omnibus = null
      }
    }
  } catch (error) {
    console.error("[decorateProductsAfterList] Failed to load unit conversions", error);
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
      F.metadata,
      'custom_fieldset_code',
      'option_schema_id',
      'omnibus_exempt',
      'first_listed_at',
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
      response: () => ({ ok: true }),
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
    responseSchema: defaultOkResponseSchema,
    description: "Updates an existing product by id.",
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: "Deletes a product by id.",
  },
});
