import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { resolveAppRoot } from '@open-mercato/core/helpers/integration/appRoot';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { hashCartToken } from '../lib/token';

/**
 * Shared fixtures for the Step 4.9 cart integration suite (`TC-CART-R1-*`, `TC-CART-CONC-*`,
 * `TC-CART-SWEEP-*`).
 *
 * A cart storefront request is addressed by its `Host` header, exactly like `ecommerce`'s own
 * TC-ECOM-* suite (`packages/core/src/modules/ecommerce/__integration__/helpers.ts`) — reused here
 * as a parallel, cart-local fixture builder rather than importing that module's helpers directly,
 * since `cart` has no hard dependency on `ecommerce`'s test-only exports and the fixture shape this
 * suite needs (store + domain mapping + one channel binding, optionally scope-restricted) is a small
 * subset of what that file builds.
 */

export const CART_CURRENT_PATH = '/api/cart/current';
export const CART_LINES_PATH = '/api/cart/current/lines';
export const CART_LINES_BULK_PATH = '/api/cart/current/lines/bulk';
export const CART_MERGE_PATH = '/api/cart/current/merge';
export const CART_UNDO_MERGE_PATH = '/api/cart/current/undo-merge';
export const CART_PROMOTIONS_PATH = '/api/cart/current/promotions';
export const cartLinePath = (lineId: string): string => `/api/cart/current/lines/${encodeURIComponent(lineId)}`;

const DOMAIN_MAPPINGS_PATH = '/api/customer_accounts/admin/domain-mappings';
const SALES_CHANNELS_PATH = '/api/sales/channels';
const STORES_PATH = '/api/ecommerce/stores';
const CHANNEL_BINDINGS_PATH = '/api/ecommerce/store-channel-bindings';
const DOMAIN_BINDINGS_PATH = '/api/ecommerce/store-domain-bindings';
const CATEGORIES_PATH = '/api/catalog/categories';
const PRODUCTS_PATH = '/api/catalog/products';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';
const PRICES_PATH = '/api/catalog/prices';
const VARIANTS_PATH = '/api/catalog/variants';

const PRODUCT_DESCRIPTION =
  'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.';

export function uniqueStamp(): string {
  return `${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function cartStorefrontHostname(stamp: string): string {
  return `cart-it-${stamp}.cart-it.example`;
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

async function deleteIfExists(request: APIRequestContext, token: string | null, path: string, id: string | null): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined);
}

export type CartAssortmentScope = { categoryIds?: string[]; tagIds?: string[] };

export type CartStorefrontFixture = {
  stamp: string;
  hostname: string;
  organizationId: string;
  tenantId: string;
  storeId: string;
  salesChannelId: string;
  channelBindingId: string;
  domainMappingId: string;
  domainBindingId: string;
};

/**
 * Provisions one storefront resolution chain: an active domain mapping (addressed by the real
 * `Host` header — API routes bypass the custom-domain proxy, same as `ecommerce`'s own helper),
 * a sales channel, a store, a default channel binding (optionally scope-restricted) and a domain
 * binding. Release with {@link cleanupCartStorefrontFixture}.
 */
export async function createCartStorefrontFixture(
  request: APIRequestContext,
  token: string,
  input: { channelAssortmentScope?: CartAssortmentScope | null } = {},
): Promise<CartStorefrontFixture> {
  const stamp = uniqueStamp();
  const { organizationId, tenantId } = getTokenContext(token);
  const hostname = cartStorefrontHostname(stamp);

  const domainMappingResponse = await apiRequest(request, 'POST', DOMAIN_MAPPINGS_PATH, {
    token,
    data: { hostname, organizationId },
  });
  expect(domainMappingResponse.status(), `domain mapping create should be 201 (${await domainMappingResponse.text()})`).toBe(201);
  const domainMappingId = expectId(
    (await readJsonSafe<{ domainMapping?: { id?: string } }>(domainMappingResponse))?.domainMapping?.id,
    'domain mapping should return an id',
  );
  await withClient(async (client) => {
    await client.query(`update domain_mappings set status = 'active', verified_at = now(), updated_at = now() where id = $1`, [domainMappingId]);
  });

  const salesChannelId = await postForId(
    request,
    token,
    SALES_CHANNELS_PATH,
    { name: `QA Cart Channel ${stamp}`, code: `qa-cart-${stamp}`, isActive: true },
    'sales channel fixture',
  );

  const storeId = await postForId(
    request,
    token,
    STORES_PATH,
    {
      code: `qa_cart_${stamp}`.replace(/-/g, '_'),
      name: `QA Cart Store ${stamp}`,
      slug: `qa-cart-${stamp}`,
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'EUR',
      settings: { display: { priceDisplayModeDefault: 'gross', enableSearch: true } },
    },
    'store fixture',
  );

  const channelBindingId = await postForId(
    request,
    token,
    CHANNEL_BINDINGS_PATH,
    {
      storeId,
      salesChannelId,
      isDefault: true,
      ...(input.channelAssortmentScope !== undefined ? { assortmentScope: input.channelAssortmentScope } : {}),
    },
    'channel binding fixture',
  );

  const domainBindingId = await postForId(
    request,
    token,
    DOMAIN_BINDINGS_PATH,
    { storeId, domainMappingId, isPrimary: true },
    'domain binding fixture',
  );

  return { stamp, hostname, organizationId, tenantId, storeId, salesChannelId, channelBindingId, domainMappingId, domainBindingId };
}

export async function cleanupCartStorefrontFixture(
  request: APIRequestContext,
  token: string | null,
  fixture: Partial<CartStorefrontFixture> | null,
): Promise<void> {
  if (!fixture) return;
  await deleteIfExists(request, token, STORES_PATH, fixture.storeId ?? null);
  await deleteIfExists(request, token, DOMAIN_MAPPINGS_PATH, fixture.domainMappingId ?? null);
  await deleteIfExists(request, token, SALES_CHANNELS_PATH, fixture.salesChannelId ?? null);
}

export type SecondTenantCartActor = {
  tenantId: string;
  organizationId: string;
  roleId: string;
  userId: string;
  token: string;
};

export async function createTenantFixture(
  request: APIRequestContext,
  superadminToken: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: superadminToken,
    data: { name },
  });
  expect(response.status(), `POST /api/directory/tenants should return 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'tenant fixture should return an id');
}

export async function deleteTenantIfExists(
  request: APIRequestContext,
  superadminToken: string | null,
  tenantId: string | null,
): Promise<void> {
  if (!superadminToken || !tenantId) return;
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(tenantId)}`, {
    token: superadminToken,
  }).catch(() => undefined);
}

/**
 * Provisions a fresh tenant + organization + role (granted every feature via the `*`
 * wildcard `setRoleAclFeatures` recognizes — this actor only ever calls setup/admin
 * endpoints to build its own `createCartStorefrontFixture`, same as the seeded `admin`
 * token does for tenant A, not a feature-scoped test subject) + user, then mints an auth
 * token for that user. Mirrors `promotions/__integration__/helpers.ts`'s own
 * `createSecondTenantActor` — `carts` is tenant- AND organization-scoped
 * (`createCartStorefrontFixture` derives both from the token passed in), so a genuinely
 * separate tenant is what exercises the real cross-tenant token-isolation boundary
 * (`TC-CART-R1-12`).
 */
export async function createSecondTenantCartActor(
  request: APIRequestContext,
  superadminToken: string,
  stamp: string,
): Promise<SecondTenantCartActor> {
  const tenantId = await createTenantFixture(request, superadminToken, `QA Cart Tenant B ${stamp}`);
  const organizationId = await createOrganizationFixture(request, superadminToken, {
    name: `QA Cart Org B ${stamp}`,
    tenantId,
  });
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `QA Cart Org B Role ${stamp}`,
    tenantId,
  });
  await setRoleAclFeatures(request, superadminToken, {
    roleId,
    features: ['*'],
    organizations: [organizationId],
  });
  const email = `qa-cart-${stamp}@test.invalid`;
  const password = 'Valid1!Pass';
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, password);
  return { tenantId, organizationId, roleId, userId, token };
}

export async function cleanupSecondTenantCartActor(
  request: APIRequestContext,
  superadminToken: string,
  actor: SecondTenantCartActor | null,
): Promise<void> {
  if (!actor) return;
  await deleteUserIfExists(request, superadminToken, actor.userId);
  await deleteRoleIfExists(request, superadminToken, actor.roleId);
  await deleteOrganizationIfExists(request, superadminToken, actor.organizationId);
  await deleteTenantIfExists(request, superadminToken, actor.tenantId);
}

/** Restricts an existing channel binding's assortment scope — used to flip a line's visibility mid-test (TC-CART-R1-05). */
export async function updateChannelBindingAssortmentScope(
  request: APIRequestContext,
  token: string,
  channelBindingId: string,
  scope: CartAssortmentScope | null,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', CHANNEL_BINDINGS_PATH, {
    token,
    data: { id: channelBindingId, assortmentScope: scope },
  });
  expect(response.status(), `channel binding scope update should be 200 (${await response.text()})`).toBe(200);
}

/**
 * Updates a store's `defaultCurrencyCode`/`supportedLocales` — the two fields
 * `resolveCartRouteContext` → `storeContextService.resolve` derives `currencyCode`/
 * `effectiveLocale` from (`lib/storeContext.ts`: `currencyCode: store.defaultCurrencyCode`,
 * `locale: resolveStoreLocale(...)` matched against `store.supportedLocales`). Used by the
 * §5.2 trigger-3 Playwright coverage (`TC-CART-PRICE-02`) to drive `currency_changed`/
 * `locale_changed` between two requests against the SAME storefront cart token — a store
 * "updated" event invalidates the resolution cache's `ecommerceStoreTag` (`lib/
 * cacheInvalidation.ts`), so the very next request resolves the new value, same as
 * {@link updateChannelBindingAssortmentScope}'s already-proven revalidation.
 */
export async function updateStoreLocaleAndCurrency(
  request: APIRequestContext,
  token: string,
  storeId: string,
  input: { defaultCurrencyCode?: string; supportedLocales?: string[] },
): Promise<void> {
  const response = await apiRequest(request, 'PUT', STORES_PATH, {
    token,
    data: { id: storeId, ...input },
  });
  expect(response.status(), `store currency/locale update should be 200 (${await response.text()})`).toBe(200);
}

export type CartProductFixture = {
  productId: string;
  categoryId: string;
  priceKindId: string;
  priceId: string;
};

/**
 * Creates one category + priced product under that category, for a channel binding's
 * `assortmentScope.categoryIds` to admit or reject. Each call mints its own price kind so
 * fixtures never collide across tests sharing the shared tenant.
 */
export async function createCartProductFixture(
  request: APIRequestContext,
  token: string,
  input: { stamp: string; label: string; salesChannelId: string; categoryId?: string | null },
): Promise<CartProductFixture> {
  const categoryId =
    input.categoryId ??
    (await postForId(
      request,
      token,
      CATEGORIES_PATH,
      { name: `QA Cart Cat ${input.label} ${input.stamp}` },
      'category fixture',
    ));

  const productId = await postForId(
    request,
    token,
    PRODUCTS_PATH,
    {
      title: `QA Cart Product ${input.label} ${input.stamp}`,
      handle: `qa-cart-${input.label}-${input.stamp}`.toLowerCase(),
      sku: `QA-CART-${input.label}-${input.stamp}`.toUpperCase(),
      description: PRODUCT_DESCRIPTION,
      categoryIds: [categoryId],
    },
    'product fixture',
  );

  const priceKindId = await postForId(
    request,
    token,
    PRICE_KINDS_PATH,
    { code: `qa_cart_${input.label}_${input.stamp}`.replace(/-/g, '_').toLowerCase(), title: `QA Cart ${input.label} ${input.stamp}`, displayMode: 'including-tax' },
    'price kind fixture',
  );

  const priceId = await postForId(
    request,
    token,
    PRICES_PATH,
    { productId, channelId: input.salesChannelId, priceKindId, currencyCode: 'EUR', unitPriceNet: 10, unitPriceGross: 12 },
    'price fixture',
  );

  return { productId, categoryId, priceKindId, priceId };
}

export async function cleanupCartProductFixture(
  request: APIRequestContext,
  token: string | null,
  fixture: Partial<CartProductFixture> & { categoryIdOwned?: boolean } | null,
): Promise<void> {
  if (!fixture) return;
  await deleteIfExists(request, token, PRODUCTS_PATH, fixture.productId ?? null);
  await deleteIfExists(request, token, PRICE_KINDS_PATH, fixture.priceKindId ?? null);
  if (fixture.categoryIdOwned !== false) {
    await deleteIfExists(request, token, CATEGORIES_PATH, fixture.categoryId ?? null);
  }
}

export type CartVariantPriceFixture = {
  productId: string;
  categoryId: string;
  priceKindId: string;
  variantAId: string;
  variantBId: string;
  priceIdForVariantA: string;
  priceIdForVariantB: string;
  unitPriceNetForVariantA: number;
  unitPriceNetForVariantB: number;
};

/**
 * QA F14 regression fixture — one product with TWO variants, each carrying its OWN
 * `CatalogProductPrice` row (scoped by `variantId` only, no `channelId`). Per
 * `catalog/commands/prices.ts`'s `createPriceCommand`, a variant-scoped price row still gets
 * its `product_id` column populated (resolved from the variant) — the exact row shape that
 * makes `cart/lib/reprice.ts`'s `fetchLinePriceRows` `{ $or: [{ product: productId }, {
 * variant: variantId }] }` clause widen to every sibling variant's rows (F14). The two rows
 * carry distinct `unitPriceNet` amounts so a cross-variant mix-up is directly observable.
 */
export async function createCartVariantPriceFixture(
  request: APIRequestContext,
  token: string,
  input: { stamp: string; label: string },
): Promise<CartVariantPriceFixture> {
  const categoryId = await postForId(
    request,
    token,
    CATEGORIES_PATH,
    { name: `QA Cart Variant Cat ${input.label} ${input.stamp}` },
    'variant-price category fixture',
  );

  const productId = await postForId(
    request,
    token,
    PRODUCTS_PATH,
    {
      title: `QA Cart Variant Product ${input.label} ${input.stamp}`,
      handle: `qa-cart-variant-${input.label}-${input.stamp}`.toLowerCase(),
      sku: `QA-CART-VARIANT-${input.label}-${input.stamp}`.toUpperCase(),
      description: PRODUCT_DESCRIPTION,
      categoryIds: [categoryId],
    },
    'variant-price product fixture',
  );

  const priceKindId = await postForId(
    request,
    token,
    PRICE_KINDS_PATH,
    {
      code: `qa_cart_variant_${input.label}_${input.stamp}`.replace(/-/g, '_').toLowerCase(),
      title: `QA Cart Variant ${input.label} ${input.stamp}`,
      displayMode: 'including-tax',
    },
    'variant-price price-kind fixture',
  );

  const variantAId = await postForId(
    request,
    token,
    VARIANTS_PATH,
    { productId, name: `Variant A ${input.stamp}`, sku: `QA-CART-VARIANT-A-${input.stamp}`.toUpperCase(), isActive: true },
    'variant A fixture',
  );
  const variantBId = await postForId(
    request,
    token,
    VARIANTS_PATH,
    { productId, name: `Variant B ${input.stamp}`, sku: `QA-CART-VARIANT-B-${input.stamp}`.toUpperCase(), isActive: true },
    'variant B fixture',
  );

  const unitPriceNetForVariantA = 138;
  const unitPriceNetForVariantB = 148;

  const priceIdForVariantA = await postForId(
    request,
    token,
    PRICES_PATH,
    {
      variantId: variantAId,
      priceKindId,
      currencyCode: 'EUR',
      unitPriceNet: unitPriceNetForVariantA,
      unitPriceGross: unitPriceNetForVariantA * 1.2,
    },
    'variant A price fixture',
  );
  const priceIdForVariantB = await postForId(
    request,
    token,
    PRICES_PATH,
    {
      variantId: variantBId,
      priceKindId,
      currencyCode: 'EUR',
      unitPriceNet: unitPriceNetForVariantB,
      unitPriceGross: unitPriceNetForVariantB * 1.2,
    },
    'variant B price fixture',
  );

  return {
    productId,
    categoryId,
    priceKindId,
    variantAId,
    variantBId,
    priceIdForVariantA,
    priceIdForVariantB,
    unitPriceNetForVariantA,
    unitPriceNetForVariantB,
  };
}

export async function cleanupCartVariantPriceFixture(
  request: APIRequestContext,
  token: string | null,
  fixture: Partial<CartVariantPriceFixture> | null,
): Promise<void> {
  if (!fixture) return;
  await deleteIfExists(request, token, PRODUCTS_PATH, fixture.productId ?? null);
  await deleteIfExists(request, token, PRICE_KINDS_PATH, fixture.priceKindId ?? null);
  await deleteIfExists(request, token, CATEGORIES_PATH, fixture.categoryId ?? null);
}

export type CartLinePricingRow = {
  unitPriceNet: string | null;
  priceRowId: string | null;
  variantId: string | null;
};

/** Reads a cart line's resolved pricing snapshot directly — the F14 regression's assertion
 * target (`cart_lines.unit_price_net`/`price_row_id`) is not part of the `/api/cart/current`
 * response envelope, same reasoning as this file's own {@link readCartLineRow}. */
export async function readCartLinePricing(lineId: string): Promise<CartLinePricingRow | null> {
  return withClient(async (client) => {
    const result = await client.query<CartLinePricingRow>(
      `select unit_price_net as "unitPriceNet", price_row_id as "priceRowId", variant_id as "variantId"
         from cart_lines where id = $1`,
      [lineId],
    );
    return (result as unknown as { rows: CartLinePricingRow[] }).rows[0] ?? null;
  });
}

function hostHeaders(hostname: string): Record<string, string> {
  return { Host: hostname };
}

export type CartStorefrontResponse = { status: number; headers: Record<string, string>; body: unknown; text: string };

export type CartStorefrontRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  cartToken?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Issues a cart `/api/cart/current/*` request addressed by `Host: hostname`, from a request
 * context that has never seen a login — the only credentials on the wire are the `X-Cart-Token`
 * header this helper sets, exactly matching §8.3/§10's "never a path segment or query string"
 * contract. `BASE_URL` defaults to `http://localhost:3000`, same convention as `ecommerce`'s own
 * `storefrontGet`.
 */
export async function cartStorefrontRequest(
  hostname: string,
  pathName: string,
  options: CartStorefrontRequestOptions = {},
): Promise<CartStorefrontResponse> {
  const baseURL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const headers: Record<string, string> = {
      ...hostHeaders(hostname),
      'Content-Type': 'application/json',
      ...(options.cartToken ? { 'X-Cart-Token': options.cartToken } : {}),
      ...(options.headers ?? {}),
    };
    const method = (options.method ?? 'POST').toLowerCase() as 'get' | 'post' | 'patch' | 'delete' | 'put';
    const response: APIResponse = await context[method](pathName, {
      headers,
      data: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status(), headers: response.headers(), body, text };
  } finally {
    await context.dispose();
  }
}

export type CartCreateResponseBody = {
  cart: { token: string; status: string };
};

/**
 * `POST /api/cart/current` against `hostname` — returns the plaintext token (§8.3, returned
 * exactly once). Step 5.2 — the §10.1 `CartView` envelope has no `cartId` field at all (the
 * spec's own addressing model is token-only, never an id the client is expected to hold), so
 * `cartId` is resolved with a direct DB lookup by the token's hash — the same hash
 * `cart.get`/`cart.lines.*` use to resolve a presented token (`lib/token.ts`'s
 * `hashCartToken`) — rather than from the response body.
 */
export async function createStorefrontCart(hostname: string): Promise<{ cartId: string; token: string }> {
  const response = await cartStorefrontRequest(hostname, CART_CURRENT_PATH, { method: 'POST', body: {} });
  expect(response.status, `cart create should be 201 (${response.text})`).toBe(201);
  const body = response.body as CartCreateResponseBody;
  const token = body.cart.token;
  const cartId = await resolveCartIdByToken(token);
  return { cartId, token };
}

/** Resolves a plaintext cart token to its row id via `token_hash` — see `createStorefrontCart`'s doc comment. */
export async function resolveCartIdByToken(token: string): Promise<string> {
  const tokenHash = hashCartToken(token);
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(`select id from carts where token_hash = $1`, [tokenHash]);
    return expectId((result as unknown as { rows: Array<{ id: string }> }).rows[0]?.id, 'cart token should resolve a cart id');
  });
}

// ---------------------------------------------------------------------------
// Sweeper coverage (TC-CART-SWEEP-*) — direct SQL backdating + queue drain.
// ---------------------------------------------------------------------------

/** Mirrors `resolveQueueBaseDir` (`push_notifications/lib/fake-provider-recorder.ts`) generically. */
export function resolveCartQueueBaseDir(): string {
  const explicit = process.env.QUEUE_BASE_DIR?.trim();
  if (explicit) return explicit;
  return path.resolve(resolveAppRoot(), '.mercato/queue');
}

export type CartRow = {
  id: string;
  status: string;
  channel: string;
  lastActivityAt: string | null;
  expiresAt: string;
  lockedAt: string | null;
  lockExpiresAt: string | null;
  checkoutSessionId: string | null;
  resolvedAt: string | null;
};

/**
 * Reads a cart's lifecycle columns directly, for assertions the `/current` response doesn't
 * expose (e.g. a rejected mutation left a line's quantity untouched) or that no longer
 * resolve once a sweep purges the row. `channel` is included (Step 5.2) because the §10.1
 * `CartView` envelope has no `channel` field at all — a test proving an anonymous caller
 * cannot override it reads the DB column directly instead.
 */
export async function readCartRow(cartId: string): Promise<CartRow | null> {
  return withClient(async (client) => {
    const result = await client.query<CartRow>(
      `select id, status, channel, last_activity_at as "lastActivityAt", expires_at as "expiresAt",
              locked_at as "lockedAt", lock_expires_at as "lockExpiresAt",
              checkout_session_id as "checkoutSessionId", resolved_at as "resolvedAt"
         from carts where id = $1`,
      [cartId],
    );
    return (result as unknown as { rows: CartRow[] }).rows[0] ?? null;
  });
}

/** Every non-deleted line for a cart+product, for concurrency assertions (TC-CART-CONC-05): how many distinct rows exist, and what quantity each settled at. */
export async function readCartLinesForProduct(cartId: string, productId: string): Promise<Array<{ id: string; quantity: string }>> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; quantity: string }>(
      `select id, quantity from cart_lines where cart_id = $1 and product_id = $2 and deleted_at is null`,
      [cartId, productId],
    );
    return (result as unknown as { rows: Array<{ id: string; quantity: string }> }).rows;
  });
}

export async function readCartLineRow(lineId: string): Promise<{ id: string; quantity: string; deletedAt: string | null } | null> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; quantity: string; deletedAt: string | null }>(
      `select id, quantity, deleted_at as "deletedAt" from cart_lines where id = $1`,
      [lineId],
    );
    return (result as unknown as { rows: Array<{ id: string; quantity: string; deletedAt: string | null }> }).rows[0] ?? null;
  });
}

/**
 * Directly bumps `carts.updated_at` — used by the concurrency suite (TC-CART-CONC-01) to
 * construct a stale-version precondition. No Phase 1 write command (`cart.lines.add`/
 * `.update`/`.bulkAdd`) touches the Cart aggregate's own `updated_at` column (only the
 * mutated `CartLine` row's `updated_at` changes) — see the step report for this finding —
 * so a genuine two-concurrent-client race never naturally advances the version today. This
 * helper exercises `enforceCommandOptimisticLock`'s own comparison directly instead.
 */
export async function touchCartUpdatedAt(cartId: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`update carts set updated_at = $2 where id = $1`, [cartId, isoTimestamp]);
  });
}

export async function backdateCartLastActivity(cartId: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`update carts set last_activity_at = $2, updated_at = now() where id = $1`, [cartId, isoTimestamp]);
  });
}

export async function backdateCartExpiresAt(cartId: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`update carts set expires_at = $2, updated_at = now() where id = $1`, [cartId, isoTimestamp]);
  });
}

/**
 * Backdates `carts.totals_computed_at` directly — drives §5.2 trigger 4 (the staleness
 * budget) over real HTTP without waiting out `CART_PRICE_STALENESS_MINUTES` in wall-clock
 * time. Same pattern as `backdateCartLastActivity`/`backdateCartExpiresAt`: a direct SQL
 * write to the ONE column `detectCartRepriceTrigger` actually compares
 * (`lib/triggers.ts`'s own doc comment on `totalsComputedAt`), deliberately NOT touching
 * `updated_at` here — unlike the other two `backdateCart*` helpers, this one is used
 * specifically to prove that `updated_at` stays unchanged across repeated in-budget GETs
 * (TC-CART-PRICE-01), so stamping it here would defeat that assertion's own premise.
 */
export async function backdateCartTotalsComputedAt(cartId: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`update carts set totals_computed_at = $2 where id = $1`, [cartId, isoTimestamp]);
  });
}

export async function forceCartLocked(cartId: string, lockExpiresAtIso: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update carts set status = 'locked', locked_at = now(), lock_expires_at = $2, checkout_session_id = 'qa-session', updated_at = now() where id = $1`,
      [cartId, lockExpiresAtIso],
    );
  });
}

export async function forceCartResolved(cartId: string, status: 'abandoned' | 'expired' | 'converted', resolvedAtIso: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`update carts set status = $2, resolved_at = $3, updated_at = now() where id = $1`, [cartId, status, resolvedAtIso]);
  });
}

/** Inserts a minimal `CartMergeLog` row so `purgeExpiredCarts`'s FK-restrict exclusion has something to reference (TC-CART-SWEEP-04). */
export async function insertCartMergeLogReference(input: {
  tenantId: string;
  organizationId: string;
  sourceCartId: string;
  targetCartId: string;
}): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into cart_merge_logs
         (id, organization_id, tenant_id, source_cart_id, target_cart_id, strategy, source_snapshot, outcome, merged_by_actor_type, created_at)
       values (gen_random_uuid(), $1, $2, $3, $4, 'sum', '{}'::jsonb, '{}'::jsonb, 'system', now())
       returning id`,
      [input.organizationId, input.tenantId, input.sourceCartId, input.targetCartId],
    );
    return (result as unknown as { rows: Array<{ id: string }> }).rows[0].id;
  });
}

export async function deleteCartMergeLog(id: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`delete from cart_merge_logs where id = $1`, [id]);
  });
}

/** Row count for a tenant's carts — used to prove a rejected `cart.create` call persisted nothing (TC-CART-R1-03). */
export async function countCartsForTenant(tenantId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(`select count(*)::text as count from carts where tenant_id = $1`, [tenantId]);
    return Number((result as unknown as { rows: Array<{ count: string }> }).rows[0]?.count ?? '0');
  });
}

export async function deleteCartRowIfExists(cartId: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(`delete from carts where id = $1`, [cartId]).catch(() => undefined);
  });
}

// ---------------------------------------------------------------------------
// Step 7.6 — Phase 3 release-gate reads: merge-log outcome/source-snapshot (TC-CART-R13-01)
// and order-scope promotion applications (TC-CART-TOT-01's Phase 3 cut).
// ---------------------------------------------------------------------------

export type CartMergeLogRow = {
  id: string;
  sourceCartId: string;
  targetCartId: string;
  strategy: string;
  sourceSnapshot: { lines?: Array<{ id?: string; productId?: string }> } & Record<string, unknown>;
  outcome: Array<{ sourceLineId: string; targetLineId: string | null; disposition: string; reason?: string }>;
  createdAt: string;
};

/** The most recently created `CartMergeLog` row for a given target cart — used to inspect
 * `outcome`/`source_snapshot` directly (§6a.5's disclosure contract names both). */
export async function readLatestCartMergeLog(targetCartId: string): Promise<CartMergeLogRow | null> {
  return withClient(async (client) => {
    const result = await client.query<CartMergeLogRow>(
      `select id, source_cart_id as "sourceCartId", target_cart_id as "targetCartId", strategy,
              source_snapshot as "sourceSnapshot", outcome, created_at as "createdAt"
         from cart_merge_logs
        where target_cart_id = $1
        order by created_at desc
        limit 1`,
      [targetCartId],
    );
    return (result as unknown as { rows: CartMergeLogRow[] }).rows[0] ?? null;
  });
}

export type CartPromotionApplicationRow = {
  id: string;
  promotionId: string;
  scope: 'order' | 'line';
  cartLineId: string | null;
  amountNet: string | null;
  amountGross: string | null;
};

/** Order-scope (`CART_DISCOUNT`) `CartPromotionApplication` rows for a cart — the §3.2
 * `SalesAdjustmentDraft[]` source the cartView envelope's own `promotions: []` placeholder
 * does not expose. */
export async function readCartPromotionApplications(cartId: string, scope?: 'order' | 'line'): Promise<CartPromotionApplicationRow[]> {
  return withClient(async (client) => {
    const result = await client.query<CartPromotionApplicationRow>(
      scope
        ? `select id, promotion_id as "promotionId", scope, cart_line_id as "cartLineId",
                  amount_net as "amountNet", amount_gross as "amountGross"
             from cart_promotion_applications where cart_id = $1 and scope = $2`
        : `select id, promotion_id as "promotionId", scope, cart_line_id as "cartLineId",
                  amount_net as "amountNet", amount_gross as "amountGross"
             from cart_promotion_applications where cart_id = $1`,
      scope ? [cartId, scope] : [cartId],
    );
    return (result as unknown as { rows: CartPromotionApplicationRow[] }).rows;
  });
}
