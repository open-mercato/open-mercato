import { z } from "zod";
import type { EntityManager } from "@mikro-orm/postgresql";
import { raw } from "@mikro-orm/postgresql";
import { buildCustomFieldFiltersFromQuery } from "@open-mercato/shared/lib/crud/custom-fields";
import type { CrudCtx } from "@open-mercato/shared/lib/crud/factory";
import { buildScopedWhere } from "@open-mercato/shared/lib/api/crud";
import { parseBooleanFlag } from "@open-mercato/shared/lib/boolean";
import { sanitizeSearchTerm } from "@open-mercato/shared/lib/query/sanitizeSearchTerm";
import { findWithDecryption } from "@open-mercato/shared/lib/encryption/find";
import { warnOnEncryptedLikeFilter } from "@open-mercato/shared/lib/encryption/likeFilterWarning";
import { buildAccentInsensitiveContainsPatternSql } from "@open-mercato/shared/lib/db/accentInsensitiveSearch";
import { createLogger } from "@open-mercato/shared/lib/logger";
import { fieldsetCodeRegex } from "@open-mercato/core/modules/entities/data/validators";
import { E } from "#generated/entities.ids.generated";
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductTagAssignment,
} from "../data/entities";
import { CATALOG_PRODUCT_TYPES } from "../data/types";
import { PRODUCT_SEARCH_COLUMNS, PRODUCT_SEARCH_EXPRESSION_SQL } from "./productSearch";

const logger = createLogger('catalog')

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export const catalogProductFilterQuerySchema = z
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

export type CatalogProductFilterQuery = z.infer<typeof catalogProductFilterQuerySchema>;

export type BuildProductFiltersOptions = {
  includeCategoryDescendants?: boolean;
};

export function parseIdList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_REGEX.test(value));
}

export async function buildProductFilters(
  query: CatalogProductFilterQuery,
  ctx: CrudCtx,
  options: BuildProductFiltersOptions = {},
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
  const scopeWhere = buildScopedWhere(
    {},
    {
      organizationId: scope.organizationId,
      organizationIds: ctx.organizationIds ?? undefined,
      tenantId: scope.tenantId,
      orgField: ctx.organizationIds === null ? null : undefined,
      softDeleteField: null,
    },
  );
  const term = sanitizeSearchTerm(query.search);
  const channelFilterIds = parseIdList(query.channelIds);
  const categoryFilterIds = parseIdList(query.categoryIds);
  const tagFilterIds = parseIdList(query.tagIds);
  const customFieldset =
    typeof query.customFieldset === "string" &&
    query.customFieldset.trim().length
      ? query.customFieldset.trim()
      : null;
  const tenantId = ctx.auth?.tenantId ?? null;

  // These prequeries are independent — each only feeds the final product-id
  // intersection, none depends on another's result — so dispatch them together
  // instead of awaiting one after another (#3179). A task returns null when its
  // filter is inactive (intersection skipped) or the matched product-id list
  // (possibly empty) when active, preserving the "active filter with no matches
  // => empty result" behavior.
  const searchTask = async (): Promise<string[] | null> => {
    if (!term) return null;
    // The predicate hides behind a raw() symbol key, which the filter walker in
    // findWithDecryption cannot see (Object.entries skips symbols), so the
    // encrypted-ILIKE diagnostic is raised here with the field list instead.
    // Without it, a tenant that encrypts one of these columns at rest gets an
    // empty result indistinguishable from a genuine no-match (#5051). It runs
    // alongside the query rather than before it: it is a development-only
    // diagnostic and must not add a round trip to the request path.
    const [searchMatches] = await Promise.all([
      findWithDecryption(
        em,
        CatalogProduct,
        {
          ...scopeWhere,
          ...(query.withDeleted ? {} : { deletedAt: null }),
          [raw(PRODUCT_SEARCH_EXPRESSION_SQL)]: {
            $ilike: raw(buildAccentInsensitiveContainsPatternSql(), [term]),
          },
        },
        { fields: ["id"] },
        scope,
      ),
      warnOnEncryptedLikeFilter({
        em,
        entityName: CatalogProduct,
        likeFields: [...PRODUCT_SEARCH_COLUMNS],
        tenantId: scope.tenantId,
      }),
    ]);
    return searchMatches
      .map((product) => product.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  };

  const channelTask = async (): Promise<string[] | null> => {
    if (!channelFilterIds.length) return null;
    const offerRows = await findWithDecryption(
      em,
      CatalogOffer,
      {
        channelId: { $in: channelFilterIds },
        deletedAt: null,
        ...scopeWhere,
      },
      { fields: ["id", "product"] },
      scope,
    );
    return offerRows
      .map((offer) =>
        typeof offer.product === "string"
          ? offer.product
          : (offer.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
  };

  const expandCategoryIds = async (): Promise<string[]> => {
    if (!options.includeCategoryDescendants) return categoryFilterIds;
    const categories = await findWithDecryption(
      em,
      CatalogProductCategory,
      { id: { $in: categoryFilterIds }, deletedAt: null, ...scopeWhere },
      { fields: ["id", "descendantIds"] },
      scope,
    );
    const expanded = new Set(categoryFilterIds);
    for (const category of categories) {
      const descendants = Array.isArray(category.descendantIds) ? category.descendantIds : [];
      for (const descendantId of descendants) {
        if (typeof descendantId === "string" && descendantId.length > 0) {
          expanded.add(descendantId);
        }
      }
    }
    return Array.from(expanded);
  };

  const categoryTask = async (): Promise<string[] | null> => {
    if (!categoryFilterIds.length) return null;
    const categoryIds = await expandCategoryIds();
    const assignments = await findWithDecryption(
      em,
      CatalogProductCategoryAssignment,
      { category: { $in: categoryIds }, ...scopeWhere },
      { fields: ["id", "product"] },
      scope,
    );
    return assignments
      .map((assignment) =>
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
  };

  const tagTask = async (): Promise<string[] | null> => {
    if (!tagFilterIds.length) return null;
    const assignments = await findWithDecryption(
      em,
      CatalogProductTagAssignment,
      { tag: { $in: tagFilterIds }, ...scopeWhere },
      { fields: ["id", "product"] },
      scope,
    );
    return assignments
      .map((assignment) =>
        typeof assignment.product === "string"
          ? assignment.product
          : (assignment.product?.id ?? null),
      )
      .filter((id): id is string => !!id);
  };

  const customFieldTask = async (): Promise<Record<string, unknown>> => {
    try {
      const scopedEm = ctx.container.resolve("em") as EntityManager;
      return await buildCustomFieldFiltersFromQuery({
        entityIds: [E.catalog.catalog_product],
        query,
        em: scopedEm,
        tenantId,
        fieldset: customFieldset ?? undefined,
      });
    } catch (err) {
      // Custom field filter parsing may fail for non-existent or misconfigured fields.
      // Fall back to base filters to avoid blocking the product listing.
      logger.debug('catalog.products custom field filter error', { err });
      return {};
    }
  };

  const [searchIds, channelIds, categoryIds, tagIds, cfFilters] =
    await Promise.all([
      searchTask(),
      channelTask(),
      categoryTask(),
      tagTask(),
      customFieldTask(),
    ]);

  // Apply intersections in the original order; intersection is commutative, so
  // the result is identical to the previous sequential pass. An empty array is
  // still intersected (active filter that matched nothing); null is skipped.
  for (const productIds of [searchIds, channelIds, categoryIds, tagIds]) {
    if (productIds) intersectProductIds(productIds);
  }
  Object.assign(filters, cfFilters);
  applyRestrictedProducts();
  return filters;
}

export function scoreProductSearchRelevance(
  needle: string,
  title: string | null | undefined,
  sku: string | null | undefined,
): number {
  const t = (title ?? "").toLowerCase();
  const s = (sku ?? "").toLowerCase();
  if (t === needle) return 0;
  if (s === needle) return 1;
  if (t.startsWith(needle)) return 2;
  if (s.startsWith(needle)) return 3;
  if (t.includes(needle)) return 4;
  if (s.includes(needle)) return 5;
  return 6;
}
