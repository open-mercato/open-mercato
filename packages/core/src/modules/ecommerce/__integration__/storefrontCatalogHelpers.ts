import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from '@open-mercato/core/helpers/integration/api';
import {
  createCustomerCompanyFixture,
  createCustomerUserFixture,
  deleteCustomerCompanyFixture,
  deleteCustomerUserFixture,
  portalLogin,
  type CustomerUserFixture,
  type PortalSession,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures';
import {
  createCustomerGroupFixture,
  createCustomerGroupMembershipFixture,
  createCustomerGroupTermsFixture,
  deleteCustomerGroupIfExists,
  deleteCustomerGroupMembershipIfExists,
} from '@open-mercato/core/helpers/integration/customerGroupsFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deletePriceKindIfExists,
  storefrontGet,
  type ChannelAssortmentScope,
  type StorefrontRequestOptions,
  type StorefrontResponse,
} from './helpers';

/**
 * Catalog, buyer and storefront-product fixtures for the storefront product suite (TC-ECOM-01x).
 * Source: .ai/specs/2026-08-14-storefront-public-api.md (rev 4) §12 and §13 Phase 1 gate.
 *
 * Every product is created through the admin catalog API, which indexes it (with `scope_keys`)
 * on write, so a store whose channel binding restricts the assortment to the fixture's categories
 * lists exactly the fixture products regardless of what else the shared tenant holds. Each
 * fixture record is registered on a {@link StorefrontFixtureTracker} and released in reverse
 * order by {@link cleanupStorefrontCatalogFixtures}.
 */

export const STOREFRONT_PRODUCTS_PATH = '/api/ecommerce/storefront/products';
export const PRODUCT_NOT_FOUND_BODY = { error: 'product_not_found' } as const;
export const LISTING_ANONYMOUS_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30';
export const DETAIL_ANONYMOUS_CACHE_CONTROL = 'public, max-age=60';
export const STOREFRONT_ERROR_CACHE_CONTROL = 'no-store';

const CATEGORIES_PATH = '/api/catalog/categories';
const PRODUCTS_PATH = '/api/catalog/products';
const PRICES_PATH = '/api/catalog/prices';
const AVAILABILITY_POLICIES_PATH = '/api/availability/policies';
const PRODUCT_TRANSLATION_ENTITY = 'catalog:catalog_product';
const PRODUCT_DESCRIPTION =
  'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.';

export type StorefrontFixtureTracker = {
  categoryIds: string[];
  productIds: string[];
  priceIds: string[];
  priceKindIds: string[];
  policyIds: string[];
  translatedProductIds: string[];
  companyIds: string[];
  customerUserIds: string[];
  groupIds: string[];
  membershipIds: string[];
};

export function createStorefrontFixtureTracker(): StorefrontFixtureTracker {
  return {
    categoryIds: [],
    productIds: [],
    priceIds: [],
    priceKindIds: [],
    policyIds: [],
    translatedProductIds: [],
    companyIds: [],
    customerUserIds: [],
    groupIds: [],
    membershipIds: [],
  };
}

async function postForId(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  label: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data });
  expect(response.status(), `${label} create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, `${label} should return an id`);
}

export async function createCategoryFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  input: { name: string; parentId?: string | null },
): Promise<string> {
  const id = await postForId(
    request,
    token,
    CATEGORIES_PATH,
    { name: input.name, ...(input.parentId ? { parentId: input.parentId } : {}) },
    'category fixture',
  );
  tracker.categoryIds.push(id);
  return id;
}

export type StorefrontProductFixtureInput = {
  title: string;
  handle: string;
  sku: string;
  categoryIds?: string[];
  tags?: string[];
  isActive?: boolean;
};

export async function createProductFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  input: StorefrontProductFixtureInput,
): Promise<string> {
  const id = await postForId(
    request,
    token,
    PRODUCTS_PATH,
    {
      title: input.title,
      handle: input.handle,
      sku: input.sku,
      description: PRODUCT_DESCRIPTION,
      ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
      ...(input.isActive === false ? { isActive: false } : {}),
    },
    'product fixture',
  );
  tracker.productIds.push(id);
  return id;
}

export async function deleteProductFixture(request: APIRequestContext, token: string, productId: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', `${PRODUCTS_PATH}?id=${encodeURIComponent(productId)}`, { token });
  expect(response.status(), `product delete should be 200 (${await response.text()})`).toBe(200);
}

export type PriceRowFixtureInput = {
  productId: string;
  priceKindId: string;
  unitPriceNet: number;
  unitPriceGross: number;
  taxRate?: number;
  currencyCode?: string;
  channelId?: string;
  customerGroupId?: string;
  customerId?: string;
};

export async function createPriceRowFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  input: PriceRowFixtureInput,
): Promise<string> {
  const id = await postForId(
    request,
    token,
    PRICES_PATH,
    { currencyCode: 'EUR', taxRate: 23, ...input },
    'price row fixture',
  );
  tracker.priceIds.push(id);
  return id;
}

/**
 * An `AvailabilityPolicy` that opts the product into stock tracking. Without a stock source the
 * catalog-only provider reports it `out_of_stock` (availability contract §4.3), which is the
 * only out-of-stock state reachable through the admin API in an environment with no inventory.
 */
export async function createOutOfStockPolicyFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  productId: string,
): Promise<string> {
  const { organizationId, tenantId } = getTokenContext(token);
  const id = await postForId(
    request,
    token,
    AVAILABILITY_POLICIES_PATH,
    { organizationId, tenantId, productId, isStockManaged: true },
    'availability policy fixture',
  );
  tracker.policyIds.push(id);
  return id;
}

export async function setProductTranslationFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  productId: string,
  translations: Record<string, Record<string, string>>,
): Promise<void> {
  const response = await apiRequest(
    request,
    'PUT',
    `/api/translations/${PRODUCT_TRANSLATION_ENTITY}/${productId}`,
    { token, data: translations },
  );
  expect(response.status(), `product translation should be 200 (${await response.text()})`).toBe(200);
  tracker.translatedProductIds.push(productId);
}

export type B2bGroupFixtureInput = {
  stamp: string;
  label: string;
  priceKindId: string;
  assortmentScope?: ChannelAssortmentScope | null;
};

export async function createB2bGroupFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  input: B2bGroupFixtureInput,
): Promise<string> {
  const groupId = await createCustomerGroupFixture(request, token, {
    code: `qa-ecom-${input.label}-${input.stamp}`,
    name: `QA ECOM ${input.label} ${input.stamp}`,
    kind: 'b2b',
  });
  tracker.groupIds.push(groupId);
  await createCustomerGroupTermsFixture(request, token, {
    groupId,
    priceKindId: input.priceKindId,
    ...(input.assortmentScope !== undefined ? { assortmentScope: input.assortmentScope } : {}),
  });
  return groupId;
}

export type CompanyBuyer = {
  companyId: string;
  user: CustomerUserFixture;
  session: PortalSession;
};

/** A portal user of a fresh company, the company a member of `groupId` when given, logged in. */
export async function createCompanyBuyerFixture(
  request: APIRequestContext,
  token: string,
  tracker: StorefrontFixtureTracker,
  input: { stamp: string; label: string; groupId?: string | null },
): Promise<CompanyBuyer> {
  const { tenantId } = getTokenContext(token);
  const companyId = await createCustomerCompanyFixture(request, token, `QA ECOM ${input.label} Co ${input.stamp}`);
  tracker.companyIds.push(companyId);
  const user = await createCustomerUserFixture(request, token, {
    customerEntityId: companyId,
    displayName: `QA ECOM ${input.label} Buyer ${input.stamp}`,
  });
  tracker.customerUserIds.push(user.id);
  if (input.groupId) {
    tracker.membershipIds.push(
      await createCustomerGroupMembershipFixture(request, token, { groupId: input.groupId, customerId: companyId }),
    );
  }
  const session = await portalLogin(request, { email: user.email, password: user.password, tenantId });
  return { companyId, user, session };
}

export async function cleanupStorefrontCatalogFixtures(
  request: APIRequestContext,
  token: string | null,
  tracker: StorefrontFixtureTracker,
): Promise<void> {
  if (!token) return;
  for (const id of tracker.membershipIds) await deleteCustomerGroupMembershipIfExists(request, token, id);
  for (const id of tracker.groupIds) await deleteCustomerGroupIfExists(request, token, id);
  for (const id of tracker.customerUserIds) await deleteCustomerUserFixture(request, token, id);
  for (const id of tracker.companyIds) await deleteCustomerCompanyFixture(request, token, id);
  for (const id of tracker.policyIds) await deleteGeneralEntityIfExists(request, token, AVAILABILITY_POLICIES_PATH, id);
  for (const id of tracker.translatedProductIds) {
    await apiRequest(request, 'DELETE', `/api/translations/${PRODUCT_TRANSLATION_ENTITY}/${id}`, { token }).catch(
      () => undefined,
    );
  }
  for (const id of tracker.priceIds) await deleteGeneralEntityIfExists(request, token, PRICES_PATH, id);
  for (const id of tracker.productIds) await deleteGeneralEntityIfExists(request, token, PRODUCTS_PATH, id);
  for (const id of [...tracker.categoryIds].reverse()) {
    await deleteGeneralEntityIfExists(request, token, CATEGORIES_PATH, id);
  }
  for (const id of tracker.priceKindIds) await deletePriceKindIfExists(request, token, id);
}

export type StorefrontPriceBody = {
  currencyCode: string;
  displayMode: 'gross' | 'net';
  amount: number;
  formatted: string;
  isPromotion: boolean;
  originalAmount: number | null;
  formattedOriginal: string | null;
  lowestPriorAmount: number | null;
  formattedLowestPrior: string | null;
};

export type StorefrontListItemBody = {
  id: string;
  handle: string | null;
  title: string;
  price: StorefrontPriceBody | null;
  availability: { state: string; canFulfil: boolean };
};

export type StorefrontProductListBody = {
  items: StorefrontListItemBody[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  effectiveLocale: string;
  requestedLocale: string | null;
  currencyCode: string;
  taxMode: 'gross' | 'net';
  appliedFilters: {
    search?: string;
    availability?: { value: 'in_stock' | 'available'; scope: 'page' };
  };
  appliedSort: string;
};

export type StorefrontProductDetailBody = StorefrontListItemBody & {
  description: string | null;
  sku: string | null;
};

export async function getStorefrontProducts(
  hostname: string,
  options: StorefrontRequestOptions = {},
): Promise<StorefrontResponse & { list: StorefrontProductListBody | null }> {
  const response = await storefrontGet(hostname, STOREFRONT_PRODUCTS_PATH, options);
  return { ...response, list: response.status === 200 ? (response.body as StorefrontProductListBody) : null };
}

export async function getStorefrontProduct(
  hostname: string,
  idOrHandle: string,
  options: StorefrontRequestOptions = {},
): Promise<StorefrontResponse & { detail: StorefrontProductDetailBody | null }> {
  const response = await storefrontGet(hostname, `${STOREFRONT_PRODUCTS_PATH}/${encodeURIComponent(idOrHandle)}`, options);
  return { ...response, detail: response.status === 200 ? (response.body as StorefrontProductDetailBody) : null };
}

export function itemIds(list: StorefrontProductListBody | null): string[] {
  return (list?.items ?? []).map((item) => item.id).sort();
}

export function itemPrice(list: StorefrontProductListBody | null, productId: string): StorefrontPriceBody | null {
  return list?.items.find((item) => item.id === productId)?.price ?? null;
}
