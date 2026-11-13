import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext } from '@playwright/test';
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
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * Shared fixtures for the Omnibus price-tracking suite (TC-CAT-OMNI-*).
 * Source: `.ai/specs/2026-06-30-omnibus-price-tracking.md` (Phases 1–3).
 *
 * The Omnibus configuration is a single tenant-scoped blob, so every spec that writes it runs
 * inside a freshly provisioned tenant ({@link createOmnibusTenantActor}) and never touches the
 * shared demo tenant's configuration.
 *
 * History rows older than "now" cannot be produced through the price API (it always records at
 * the moment of the write), so {@link insertPriceHistoryRows} inserts them directly — the same
 * `dbFixtures` precedent used for preconditions the API cannot produce. The immutability trigger
 * blocks UPDATE/DELETE on `catalog_price_history_entries`, so these rows are never cleaned up;
 * they are scoped to throwaway products of a throwaway tenant and are therefore harmless.
 */

export const PRICE_HISTORY_PATH = '/api/catalog/prices/history';
export const OMNIBUS_PREVIEW_PATH = '/api/catalog/prices/omnibus-preview';
export const OMNIBUS_CONFIG_PATH = '/api/catalog/config/omnibus';
export const PRICES_PATH = '/api/catalog/prices';
export const PRICE_KINDS_PATH = '/api/catalog/price-kinds';
export const PRODUCTS_PATH = '/api/catalog/products';
const SALES_CHANNELS_PATH = '/api/sales/channels';

export const OMNIBUS_ACTOR_PASSWORD = 'Valid1!Pass';

export type PriceHistoryItem = {
  id: string;
  priceId: string;
  productId: string;
  variantId: string | null;
  offerId: string | null;
  channelId: string | null;
  priceKindId: string;
  priceKindCode: string;
  currencyCode: string;
  unitPriceNet: string | null;
  unitPriceGross: string | null;
  taxRate: string | null;
  startsAt: string | null;
  recordedAt: string;
  changeType: 'create' | 'update' | 'delete' | 'undo';
  source: 'api' | 'system';
  isAnnounced: boolean;
};

export type PriceHistoryPage = { items: PriceHistoryItem[]; nextCursor: string | null; total?: number };

export type OmnibusBlock = {
  presentedPriceKindId: string | null;
  lookbackDays: number;
  minimizationAxis: 'gross' | 'net';
  promotionAnchorAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  coverageStartAt: string | null;
  lowestPriceNet: string | null;
  lowestPriceGross: string | null;
  previousPriceNet: string | null;
  previousPriceGross: string | null;
  currencyCode: string;
  applicable: boolean;
  applicabilityReason: string;
};

export function uniqueStamp(): string {
  return `${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export async function createPriceKindFixture(
  request: APIRequestContext,
  token: string,
  input: { stamp: string; suffix: string; isPromotion?: boolean },
): Promise<string> {
  const code = `qa_omni_${input.suffix}_${input.stamp}`.replace(/-/g, '_');
  const response = await apiRequest(request, 'POST', PRICE_KINDS_PATH, {
    token,
    data: {
      code,
      title: `QA OMNI ${input.suffix} ${input.stamp}`,
      displayMode: 'including-tax',
      ...(input.isPromotion ? { isPromotion: true } : {}),
    },
  });
  expect(response.status(), `price kind fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'price kind fixture should return an id');
}

export async function createSalesChannelFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', SALES_CHANNELS_PATH, {
    token,
    data: { name: `QA OMNI Channel ${stamp}`, code: `qa-omni-${stamp}`, isActive: true },
  });
  expect(response.status(), `sales channel fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'sales channel fixture should return an id');
}

export async function createOmnibusProductFixture(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCTS_PATH, {
    token,
    data: {
      title: `QA OMNI Product ${stamp}`,
      sku: `QA-OMNI-${stamp}`,
      description:
        'Long enough description for SEO checks in QA automation flows. This text keeps the create validation satisfied.',
    },
  });
  expect(response.status(), `product fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'product fixture should return an id');
}

export type PriceFixtureInput = {
  productId: string;
  priceKindId: string;
  currencyCode?: string;
  unitPriceNet: number;
  unitPriceGross: number;
  taxRate?: number;
  channelId?: string;
  startsAt?: string;
};

export async function createPriceFixture(
  request: APIRequestContext,
  token: string,
  input: PriceFixtureInput,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRICES_PATH, {
    token,
    data: { currencyCode: 'EUR', taxRate: 23, ...input },
  });
  expect(response.status(), `price fixture create should be 201 (${await response.text()})`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'price fixture should return an id');
}

export async function deleteEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  collectionPath: string,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, collectionPath, id);
}

export async function deleteSalesChannelIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  await deleteGeneralEntityIfExists(request, token, SALES_CHANNELS_PATH, id);
}

export async function fetchPriceHistory(
  request: APIRequestContext,
  token: string,
  query: Record<string, string>,
): Promise<{ status: number; body: PriceHistoryPage | null }> {
  const search = new URLSearchParams(query).toString();
  const response = await apiRequest(request, 'GET', `${PRICE_HISTORY_PATH}?${search}`, { token });
  return { status: response.status(), body: await readJsonSafe<PriceHistoryPage>(response) };
}

export async function fetchOmnibusPreview(
  request: APIRequestContext,
  token: string,
  query: Record<string, string>,
): Promise<{ status: number; body: OmnibusBlock | null; text: string }> {
  const search = new URLSearchParams(query).toString();
  const response = await apiRequest(request, 'GET', `${OMNIBUS_PREVIEW_PATH}?${search}`, { token });
  const text = await response.text();
  let body: OmnibusBlock | null = null;
  try {
    body = text ? (JSON.parse(text) as OmnibusBlock | null) : null;
  } catch {
    body = null;
  }
  return { status: response.status(), body, text };
}

export async function patchOmnibusConfig(
  request: APIRequestContext,
  token: string,
  data: unknown,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'PATCH', OMNIBUS_CONFIG_PATH, { token, data });
  return { status: response.status(), body: await readJsonSafe<Record<string, unknown>>(response) };
}

export async function getOmnibusConfig(
  request: APIRequestContext,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await apiRequest(request, 'GET', OMNIBUS_CONFIG_PATH, { token });
  return { status: response.status(), body: await readJsonSafe<Record<string, unknown>>(response) };
}

export type HistoryRowInput = {
  tenantId: string;
  organizationId: string;
  priceId: string;
  productId: string;
  channelId: string | null;
  priceKindId: string;
  priceKindCode: string;
  currencyCode: string;
  unitPriceNet: string;
  unitPriceGross: string;
  taxRate: string;
  recordedAt: Date;
  changeType: 'create' | 'update';
};

export async function insertPriceHistoryRows(rows: HistoryRowInput[]): Promise<void> {
  await withClient(async (client) => {
    for (const row of rows) {
      await client.query(
        `insert into catalog_price_history_entries
           (id, tenant_id, organization_id, price_id, product_id, channel_id, price_kind_id, price_kind_code,
            currency_code, unit_price_net, unit_price_gross, tax_rate, min_quantity, recorded_at,
            change_type, source, is_announced, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, $14, 'system', false, null)`,
        [
          randomUUID(),
          row.tenantId,
          row.organizationId,
          row.priceId,
          row.productId,
          row.channelId,
          row.priceKindId,
          row.priceKindCode,
          row.currencyCode,
          row.unitPriceNet,
          row.unitPriceGross,
          row.taxRate,
          row.recordedAt.toISOString(),
          row.changeType,
        ],
      );
    }
  });
}

export async function readPriceKindCode(priceKindId: string): Promise<string> {
  return withClient(async (client) => {
    const result = await client.query<{ code: string }>('select code from catalog_price_kinds where id = $1', [
      priceKindId,
    ]);
    return expectId(result.rows[0]?.code, 'price kind code should be readable');
  });
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..', '..', '..', '..', '..');
const cliBin = path.join(repoRoot, 'packages', 'cli', 'dist', 'bin.js');
const appDir = path.join(repoRoot, 'apps', 'mercato');

/**
 * Runs the real `mercato catalog omnibus:backfill` CLI for one channel of one tenant and returns
 * its stdout. The CLI inherits the test process environment (DATABASE_URL and, under the
 * ephemeral runner, the shared sqlite cache), exactly like an operator would run it.
 */
export function runOmnibusBackfillCli(input: { tenantId: string; channelId: string }): string {
  return execFileSync(
    process.execPath,
    [cliBin, 'catalog', 'omnibus:backfill', '--tenant', input.tenantId, '--channel-id', input.channelId],
    {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    },
  );
}

export type OmnibusTenantActor = {
  tenantId: string;
  organizationId: string;
  roleId: string;
  userId: string;
  email: string;
  token: string;
};

/**
 * Provisions a brand-new tenant with one organization, one role carrying `features` and one user,
 * and returns a token for that user. The superadmin token is required because only a superadmin
 * can create tenants and grant role ACLs across tenants.
 */
export async function createOmnibusTenantActor(
  request: APIRequestContext,
  superadminToken: string,
  stamp: string,
  features: string[],
): Promise<OmnibusTenantActor> {
  const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
    token: superadminToken,
    data: { name: `QA OMNI Tenant ${stamp}` },
  });
  expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'tenant fixture id');
  const organizationId = await createOrganizationFixture(request, superadminToken, {
    name: `QA OMNI Org ${stamp}`,
    tenantId,
  });
  const roleId = await createRoleFixture(request, superadminToken, { name: `QA OMNI Role ${stamp}`, tenantId });
  await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [organizationId] });
  const email = `qa-omni-${stamp}@test.invalid`;
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password: OMNIBUS_ACTOR_PASSWORD,
    organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, OMNIBUS_ACTOR_PASSWORD);
  return { tenantId, organizationId, roleId, userId, email, token };
}

/**
 * Adds one more user with its own role (and `features`) to an existing actor's tenant, for ACL
 * checks against a narrower feature set.
 */
export async function createRestrictedUser(
  request: APIRequestContext,
  superadminToken: string,
  actor: OmnibusTenantActor,
  stamp: string,
  features: string[],
): Promise<{ roleId: string; userId: string; token: string }> {
  const roleId = await createRoleFixture(request, superadminToken, {
    name: `QA OMNI Restricted ${stamp}`,
    tenantId: actor.tenantId,
  });
  await setRoleAclFeatures(request, superadminToken, { roleId, features, organizations: [actor.organizationId] });
  const email = `qa-omni-restricted-${stamp}@test.invalid`;
  const userId = await createUserFixture(request, superadminToken, {
    email,
    password: OMNIBUS_ACTOR_PASSWORD,
    organizationId: actor.organizationId,
    roles: [roleId],
  });
  const token = await getAuthToken(request, email, OMNIBUS_ACTOR_PASSWORD);
  return { roleId, userId, token };
}

export async function cleanupOmnibusTenantActor(
  request: APIRequestContext,
  superadminToken: string | null,
  actor: OmnibusTenantActor | null,
): Promise<void> {
  if (!actor || !superadminToken) return;
  await deleteUserIfExists(request, superadminToken, actor.userId);
  await deleteRoleIfExists(request, superadminToken, actor.roleId);
  await deleteOrganizationIfExists(request, superadminToken, actor.organizationId);
  await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${encodeURIComponent(actor.tenantId)}`, {
    token: superadminToken,
  }).catch(() => undefined);
}

export async function cleanupRestrictedUser(
  request: APIRequestContext,
  superadminToken: string | null,
  restricted: { roleId: string; userId: string } | null,
): Promise<void> {
  if (!restricted || !superadminToken) return;
  await deleteUserIfExists(request, superadminToken, restricted.userId);
  await deleteRoleIfExists(request, superadminToken, restricted.roleId);
}
