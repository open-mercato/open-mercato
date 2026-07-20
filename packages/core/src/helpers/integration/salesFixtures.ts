import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';

type JsonMap = Record<string, unknown>;

function readId(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as JsonMap;
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const value of Object.values(map)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = readId(value, keys);
      if (nested) return nested;
    }
  }
  return null;
}

// Create-heavy suites can exhaust the ephemeral Postgres connection budget, which
// surfaces as a transient 5xx. Retry only that signature — a genuine 500 regression
// must still fail on the first attempt instead of being masked by three retries.
const CONNECTION_EXHAUSTION_MARKERS = [
  'too many clients',
  'remaining connection slots',
  'connection terminated',
  'connection pool',
  'econnreset',
  'etimedout',
];

function isTransientInfrastructureFailure(status: number, body: string): boolean {
  if (status === 503) return true;
  if (status !== 500) return false;
  const haystack = body.toLowerCase();
  return CONNECTION_EXHAUSTION_MARKERS.some((marker) => haystack.includes(marker));
}

async function createEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[],
): Promise<string> {
  let response = await apiRequest(request, 'POST', path, { token, data });
  let bodyText = await response.text();
  for (
    let attempt = 0;
    attempt < 3 && isTransientInfrastructureFailure(response.status(), bodyText);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    response = await apiRequest(request, 'POST', path, { token, data });
    bodyText = await response.text();
  }
  expect(
    response.ok(),
    `Failed POST ${path}: ${response.status()} ${bodyText.slice(0, 500)}`,
  ).toBeTruthy();
  const id = readId(JSON.parse(bodyText) as unknown, idKeys);
  expect(id, `No id in POST ${path} response`).toBeTruthy();
  return id as string;
}

export async function createSalesQuoteFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createEntity(request, token, '/api/sales/quotes', { currencyCode }, ['id', 'quoteId']);
}

export async function createSalesOrderFixture(
  request: APIRequestContext,
  token: string,
  currencyCode = 'USD',
): Promise<string> {
  return createEntity(request, token, '/api/sales/orders', { currencyCode }, ['id', 'orderId']);
}

export async function createOrderLineFixture(
  request: APIRequestContext,
  token: string,
  orderId: string,
  data?: Record<string, unknown>,
): Promise<string> {
  return createEntity(
    request,
    token,
    '/api/sales/order-lines',
    {
      orderId,
      currencyCode: 'USD',
      quantity: 1,
      name: `QA line ${Date.now()}`,
      unitPriceNet: 10,
      unitPriceGross: 12,
      ...(data ?? {}),
    },
    ['id', 'lineId'],
  );
}

/**
 * Ship one or more order lines so a subsequent return passes the
 * shipped-quantity guard (issue #3034). A return can only be created for
 * quantities that were physically shipped, so any spec that creates a return
 * must ship the relevant line(s) first. Returns the created shipment id.
 */
export async function createShipmentFixture(
  request: APIRequestContext,
  token: string,
  orderId: string,
  items: Array<{ orderLineId: string; quantity: number }>,
): Promise<string> {
  return createEntity(
    request,
    token,
    '/api/sales/shipments',
    { orderId, items },
    ['id', 'shipmentId'],
  );
}

/**
 * Probe whether the authenticated principal can create a sales order on the
 * current tenant (i.e. holds `sales.orders.manage`). Sales-write integration
 * specs use this to self-skip on dev databases whose role ACLs were never
 * synced (`yarn mercato auth sync-role-acls`) rather than fail spuriously —
 * CI bootstraps a fully-synced tenant so the probe passes there. The probed
 * order is deleted immediately so the check leaves no residue.
 *
 * Only `403` counts as "unsynced ACLs". Any other failure fails the spec: a probe
 * that returned false for every non-OK response would convert a real sales-route
 * regression into a suite full of green skips, which reads as coverage that ran.
 */
export async function canManageSalesOrders(
  request: APIRequestContext,
  token: string,
): Promise<boolean> {
  const response = await apiRequest(request, 'POST', '/api/sales/orders', {
    token,
    data: { currencyCode: 'USD' },
  });
  if (response.status() === 403) return false;
  const bodyText = await response.text();
  expect(
    response.ok(),
    `canManageSalesOrders probe failed with ${response.status()}: ${bodyText.slice(0, 500)}`,
  ).toBeTruthy();
  const id = readId(JSON.parse(bodyText) as unknown, ['id', 'orderId']);
  if (id) {
    try {
      await apiRequest(request, 'DELETE', '/api/sales/orders', { token, data: { id } });
    } catch {
      // best-effort cleanup
    }
  }
  return true;
}

export async function deleteSalesEntityIfExists(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token });
  } catch {
    return;
  }
}

