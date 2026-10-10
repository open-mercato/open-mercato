import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * Shared fixtures for the `ecommerce` storefront-resolution integration suite (TC-ECOM-*).
 *
 * A storefront request is addressed by its `Host` header. The test-only `X-Force-Host` override
 * is honored only under `NODE_ENV=test`, which the ephemeral production build never runs with, so
 * every storefront call sends the custom hostname as a real `Host` header (API routes bypass the
 * custom-domain proxy). The force-host pair is added as well when `FORCE_HOST_SECRET` is present in
 * the test process, so a `NODE_ENV=test` dev server resolves the same host.
 *
 * `customer_accounts` only activates a `DomainMapping` after a real DNS + TLS check, so
 * {@link createDomainMappingFixture} registers the mapping through the admin API and then sets
 * its status directly in the database, mirroring the `dbFixtures` precedent for preconditions the
 * API cannot produce.
 */

export const STORES_PATH = '/api/ecommerce/stores';
export const CHANNEL_BINDINGS_PATH = '/api/ecommerce/store-channel-bindings';
export const DOMAIN_BINDINGS_PATH = '/api/ecommerce/store-domain-bindings';
export const STOREFRONT_CONTEXT_PATH = '/api/ecommerce/storefront/context';
const DOMAIN_MAPPINGS_PATH = '/api/customer_accounts/admin/domain-mappings';
const SALES_CHANNELS_PATH = '/api/sales/channels';
const PRICE_KINDS_PATH = '/api/catalog/price-kinds';

export const ANONYMOUS_CACHE_CONTROL = 'public, max-age=60';
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

export type PriceKindDisplayMode = 'including-tax' | 'excluding-tax';
export type StoreStatus = 'draft' | 'active' | 'archived';
export type DomainMappingStatus = 'pending' | 'verified' | 'active' | 'dns_failed' | 'tls_failed';

export function uniqueStamp(): string {
  return `${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export function storefrontHostname(stamp: string, label = 'shop'): string {
  return `${label}-${stamp}.ecom-it.example`;
}

export async function createSalesChannelFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', SALES_CHANNELS_PATH, {
    token,
    data: { name: `QA ECOM Channel ${stamp}`, code: `qa-ecom-${stamp}`, isActive: true },
  });
  expect(response.status(), 'sales channel fixture create should be 201').toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'sales channel fixture should return an id');
}

export async function deleteSalesChannelIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, SALES_CHANNELS_PATH, id);
}

export async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  input: { stamp: string; suffix: string; displayMode: PriceKindDisplayMode; isPromotion?: boolean },
): Promise<string> {
  const code = `qa_ecom_${input.suffix}_${input.stamp}`.replace(/-/g, '_');
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: {
      code,
      title: `QA ECOM ${input.suffix} ${input.stamp}`,
      displayMode: input.displayMode,
      ...(input.isPromotion ? { isPromotion: true } : {}),
    },
  });
  expect(response.status(), `price kind fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'price kind fixture should return an id');
}

export async function deletePriceKindIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, PRICE_KINDS_PATH, id);
}

export async function setDomainMappingStatus(domainMappingId: string, status: DomainMappingStatus): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `update domain_mappings
          set status = $2,
              verified_at = case when $2 in ('verified', 'active') then now() else verified_at end,
              updated_at = now()
        where id = $1`,
      [domainMappingId, status],
    );
  });
}

export async function createDomainMappingFixture(
  request: APIRequestContext,
  token: string,
  input: { hostname: string; organizationId: string; status?: DomainMappingStatus },
): Promise<string> {
  const response = await apiRequest(request, 'POST', DOMAIN_MAPPINGS_PATH, {
    token,
    data: { hostname: input.hostname, organizationId: input.organizationId },
  });
  expect(response.status(), `domain mapping fixture create should be 201 (${await response.text()})`).toBe(201);
  const body = await readJsonSafe<{ domainMapping?: { id?: string } }>(response);
  const id = expectId(body?.domainMapping?.id, 'domain mapping fixture should return an id');
  await setDomainMappingStatus(id, input.status ?? 'active');
  return id;
}

export async function deleteDomainMappingIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  await apiRequest(request, 'DELETE', `${DOMAIN_MAPPINGS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(
    () => undefined,
  );
}

export type StoreFixtureInput = {
  stamp: string;
  status?: StoreStatus;
  defaultLocale?: string;
  supportedLocales?: string[];
  defaultCurrencyCode?: string;
  priceDisplayModeDefault?: 'gross' | 'net';
};

export async function createStoreFixture(
  request: APIRequestContext,
  token: string,
  input: StoreFixtureInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STORES_PATH, {
    token,
    data: {
      code: `qa_ecom_${input.stamp}`.replace(/-/g, '_'),
      name: `QA ECOM Store ${input.stamp}`,
      slug: `qa-ecom-${input.stamp}`,
      status: input.status ?? 'active',
      defaultLocale: input.defaultLocale ?? 'en',
      supportedLocales: input.supportedLocales ?? ['en'],
      defaultCurrencyCode: input.defaultCurrencyCode ?? 'EUR',
      settings: { display: { priceDisplayModeDefault: input.priceDisplayModeDefault ?? 'gross', enableSearch: true } },
    },
  });
  expect(response.status(), `store fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'store fixture should return an id');
}

export async function deleteStoreIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, STORES_PATH, id);
}

export type ChannelAssortmentScope = {
  categoryIds?: string[];
  tagIds?: string[];
  excludeProductIds?: string[];
  excludeCategoryIds?: string[];
  excludeTagIds?: string[];
};

export async function createChannelBindingFixture(
  request: APIRequestContext,
  token: string,
  input: {
    storeId: string;
    salesChannelId: string;
    priceKindId?: string | null;
    isDefault?: boolean;
    assortmentScope?: ChannelAssortmentScope | null;
  },
): Promise<string> {
  const response = await apiRequest(request, 'POST', CHANNEL_BINDINGS_PATH, {
    token,
    data: {
      storeId: input.storeId,
      salesChannelId: input.salesChannelId,
      priceKindId: input.priceKindId ?? null,
      isDefault: input.isDefault ?? true,
      ...(input.assortmentScope !== undefined ? { assortmentScope: input.assortmentScope } : {}),
    },
  });
  expect(response.status(), `channel binding fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'channel binding fixture should return an id');
}

export async function createDomainBindingFixture(
  request: APIRequestContext,
  token: string,
  input: { storeId: string; domainMappingId: string; pathPrefix?: string | null; isPrimary?: boolean },
): Promise<string> {
  const response = await apiRequest(request, 'POST', DOMAIN_BINDINGS_PATH, {
    token,
    data: {
      storeId: input.storeId,
      domainMappingId: input.domainMappingId,
      pathPrefix: input.pathPrefix ?? null,
      isPrimary: input.isPrimary ?? true,
    },
  });
  expect(response.status(), `domain binding fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'domain binding fixture should return an id');
}

export type StorefrontFixture = {
  stamp: string;
  hostname: string;
  organizationId: string;
  tenantId: string;
  storeId: string;
  salesChannelId: string;
  domainMappingId: string;
  channelPriceKindId: string | null;
  channelBindingId: string | null;
  domainBindingId: string;
};

export type StorefrontFixtureInput = Omit<StoreFixtureInput, 'stamp'> & {
  stamp?: string;
  channelPriceKindId?: string | null;
  channelAssortmentScope?: ChannelAssortmentScope | null;
  withChannelBinding?: boolean;
  domainMappingStatus?: DomainMappingStatus;
};

/**
 * Provisions the full resolution chain for one store: an `active` (by default) domain mapping,
 * a sales channel, the store, its default channel binding (optional, to exercise the `503`) and
 * its domain binding. Release with {@link cleanupStorefrontFixture}.
 */
export async function createStorefrontFixture(
  request: APIRequestContext,
  token: string,
  input: StorefrontFixtureInput = {},
): Promise<StorefrontFixture> {
  const stamp = input.stamp ?? uniqueStamp();
  const { organizationId, tenantId } = getTokenContext(token);
  const hostname = storefrontHostname(stamp);
  const partial: Partial<StorefrontFixture> = { stamp, hostname, organizationId, tenantId };
  try {
    partial.domainMappingId = await createDomainMappingFixture(request, token, {
      hostname,
      organizationId,
      status: input.domainMappingStatus ?? 'active',
    });
    partial.salesChannelId = await createSalesChannelFixture(request, token, stamp);
    partial.storeId = await createStoreFixture(request, token, { ...input, stamp });
    partial.channelPriceKindId = input.channelPriceKindId ?? null;
    partial.channelBindingId =
      input.withChannelBinding === false
        ? null
        : await createChannelBindingFixture(request, token, {
            storeId: partial.storeId,
            salesChannelId: partial.salesChannelId,
            priceKindId: partial.channelPriceKindId,
            assortmentScope: input.channelAssortmentScope,
          });
    partial.domainBindingId = await createDomainBindingFixture(request, token, {
      storeId: partial.storeId,
      domainMappingId: partial.domainMappingId,
    });
    return partial as StorefrontFixture;
  } catch (error) {
    await cleanupStorefrontFixture(request, token, partial);
    throw error;
  }
}

export async function cleanupStorefrontFixture(
  request: APIRequestContext,
  token: string | null,
  fixture: Partial<StorefrontFixture> | null,
): Promise<void> {
  if (!fixture) return;
  await deleteStoreIfExists(request, token, fixture.storeId ?? null);
  await deleteDomainMappingIfExists(request, token, fixture.domainMappingId ?? null);
  await deleteSalesChannelIfExists(request, token, fixture.salesChannelId ?? null);
}

export async function updateStoreStatus(
  request: APIRequestContext,
  token: string,
  storeId: string,
  status: StoreStatus,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', STORES_PATH, { token, data: { id: storeId, status } });
  expect(response.status(), `store status update should be 200 (${await response.text()})`).toBe(200);
}

export async function setChannelBindingRequireAuthentication(
  request: APIRequestContext,
  token: string,
  bindingId: string,
  requireAuthentication: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', CHANNEL_BINDINGS_PATH, {
    token,
    data: { id: bindingId, requireAuthentication },
  });
  expect(response.status(), `channel binding update should be 200 (${await response.text()})`).toBe(200);
}

function hostHeaders(hostname: string): Record<string, string> {
  const headers: Record<string, string> = { Host: hostname };
  const forceHostSecret = process.env.FORCE_HOST_SECRET?.trim();
  if (forceHostSecret) {
    headers['X-Force-Host'] = hostname;
    headers['X-Force-Host-Secret'] = forceHostSecret;
  }
  return headers;
}

export type StorefrontRequestOptions = {
  query?: Record<string, string>;
  cookie?: string;
  bearer?: string;
  headers?: Record<string, string>;
};

export type StorefrontResponse = { status: number; headers: Record<string, string>; body: unknown; text: string };

/**
 * Issues `GET <path>` against the storefront served at `hostname`, from a request context that has
 * never seen a login, so the only credentials on the wire are the ones passed in `options`.
 */
export async function storefrontGet(
  hostname: string,
  path: string,
  options: StorefrontRequestOptions = {},
): Promise<StorefrontResponse> {
  const baseURL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const search = new URLSearchParams(options.query ?? {}).toString();
    const headers: Record<string, string> = { ...hostHeaders(hostname), ...(options.headers ?? {}) };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`;
    const response: APIResponse = await context.get(`${path}${search ? `?${search}` : ''}`, { headers });
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

/** `GET /api/ecommerce/storefront/context` for `hostname`; see {@link storefrontGet}. */
export async function getStorefrontContext(
  hostname: string,
  options: StorefrontRequestOptions = {},
): Promise<StorefrontResponse> {
  return storefrontGet(hostname, STOREFRONT_CONTEXT_PATH, options);
}

export type StorefrontContextBody = {
  store: {
    id: string;
    code: string;
    name: string;
    slug: string;
    status: string;
    defaultLocale: string;
    supportedLocales: string[];
    defaultCurrencyCode: string;
  };
  effectiveLocale: string;
  requestedLocale: string | null;
  supportedLocales: string[];
  currencyCode: string;
  buyer: {
    isAuthenticated: boolean;
    taxMode: 'gross' | 'net';
    displayName: string | null;
    companyName: string | null;
    allowPurchaseOnAccount: boolean;
  };
};

export function asContextBody(body: unknown): StorefrontContextBody {
  expect(body && typeof body === 'object' && 'store' in body && 'buyer' in body, 'context body shape').toBe(true);
  return body as StorefrontContextBody;
}

export type SecondTenantActor = {
  tenantId: string;
  organizationId: string;
  roleId: string;
  userId: string;
  token: string;
};

export async function createSecondTenantActor(
  request: APIRequestContext,
  superadminToken: string,
  stamp: string,
  features: string[],
): Promise<SecondTenantActor> {
  const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: superadminToken,
    data: { name: `QA ECOM Tenant B ${stamp}` },
  });
  expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant fixture id');
  const organizationId = await createOrganizationFixture(request, superadminToken, {
    name: `QA ECOM Org B ${stamp}`,
    tenantId,
  });
  const roleId = await createRoleFixture(request, superadminToken, { name: `QA ECOM Role B ${stamp}`, tenantId });
  await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [organizationId] });
  const email = `qa-ecom-${stamp}@test.invalid`;
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

export async function cleanupSecondTenantActor(
  request: APIRequestContext,
  superadminToken: string | null,
  actor: SecondTenantActor | null,
): Promise<void> {
  if (!actor || !superadminToken) return;
  await deleteUserIfExists(request, superadminToken, actor.userId);
  await deleteRoleIfExists(request, superadminToken, actor.roleId);
  await deleteOrganizationIfExists(request, superadminToken, actor.organizationId);
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(actor.tenantId)}`, {
    token: superadminToken,
  }).catch(() => undefined);
}

export const STORE_BRANDING_PATH = (storeId: string): string =>
  `${STORES_PATH}/${encodeURIComponent(storeId)}/branding`;
export const STORE_PREVIEW_BRANDING_PATH = (storeId: string): string =>
  `${STORES_PATH}/${encodeURIComponent(storeId)}/preview-branding`;
export const ASSORTMENT_COUNT_PATH = (bindingId: string): string =>
  `${CHANNEL_BINDINGS_PATH}/${encodeURIComponent(bindingId)}/assortment-count`;
export const ECOMMERCE_DOMAIN_MAPPINGS_PATH = '/api/ecommerce/domain-mappings';

export type StoreRecordBody = {
  id: string;
  code: string;
  name: string;
  status: StoreStatus;
  updatedAt: string;
  settings: Record<string, unknown> | null;
};

/** Reads one store through the admin list route (`GET /api/ecommerce/stores?id=`). */
export async function readStoreRecord(
  request: APIRequestContext,
  token: string,
  storeId: string,
): Promise<StoreRecordBody> {
  const response = await apiRequest(request, 'GET', `${STORES_PATH}?id=${encodeURIComponent(storeId)}`, { token });
  expect(response.status(), 'store read should be 200').toBe(200);
  const item = (await readJsonSafe<{ items?: StoreRecordBody[] }>(response))?.items?.[0];
  expect(item, `store ${storeId} should be listed`).toBeTruthy();
  return item as StoreRecordBody;
}

export function toEpochMs(value: string): number {
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T').replace(/\+00$/, 'Z'));
  expect(Number.isFinite(parsed), `timestamp should parse: ${value}`).toBe(true);
  return parsed;
}

export type ScopedActor = { roleId: string; userId: string; token: string };

/**
 * A user in the given organization whose only role grants `features`, for permission-gate checks
 * inside the shared tenant. Release with {@link cleanupScopedActor}.
 */
export async function createScopedActor(
  request: APIRequestContext,
  superadminToken: string,
  input: { stamp: string; tenantId: string; organizationId: string; features: string[]; label: string },
): Promise<ScopedActor> {
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `QA ECOM ${input.label} ${input.stamp}`,
    tenantId: input.tenantId,
  });
  try {
    await setRoleAclFeatures(request, superadminToken, {
      roleId,
      features: input.features,
      organizations: [input.organizationId],
    });
    const email = `qa-ecom-${input.label}-${input.stamp}@test.invalid`.toLowerCase();
    const password = 'Valid1!Pass';
    const userId = await createUserFixture(request, superadminToken, {
      email,
      password,
      organizationId: input.organizationId,
      roles: [roleId],
    });
    const token = await getAuthToken(request, email, password);
    return { roleId, userId, token };
  } catch (error) {
    await deleteRoleIfExists(request, superadminToken, roleId);
    throw error;
  }
}

export async function cleanupScopedActor(
  request: APIRequestContext,
  superadminToken: string | null,
  actor: ScopedActor | null,
): Promise<void> {
  if (!actor || !superadminToken) return;
  await deleteUserIfExists(request, superadminToken, actor.userId);
  await deleteRoleIfExists(request, superadminToken, actor.roleId);
}
