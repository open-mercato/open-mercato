import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { readJsonSafe } from './generalFixtures';

type JsonMap = Record<string, unknown>;

export type FreightCustomerSnapshotInput = {
  id: string;
  kind: 'company' | 'person';
  displayName: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
};

export type FreightOrderFixtureInput = {
  customerId: string;
  customerSnapshot: FreightCustomerSnapshotInput;
  cargoDescription?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  agreedAmountNet?: string | number;
  adjustmentAmountNet?: string | number | null;
  vatRate?: string | number;
  requestedPickupAt?: string;
  requestedDeliveryAt?: string;
  truckTypeRequired?: string;
};

export type FreightContractFixtureInput = {
  customerId: string;
  customerSnapshot: FreightCustomerSnapshotInput;
  title?: string;
  validFrom?: string;
  validTo?: string;
  requiresCustomerApproval?: boolean;
  paymentTermsDays?: number;
};

export type FreightContractRouteFixtureInput = {
  origin?: string;
  destination?: string;
  rateBasis?: string;
  rateAmount?: string | number;
  minimumCharge?: string | number | null;
  lineNumber?: number;
};

export type FreightTripFixtureInput = {
  contractId: string;
  contractRouteId: string;
  executionDate?: string;
  quantity?: string | number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function isoInstant(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString();
}

let fixtureCounter = 0;
export function uniqueFreightSuffix(): string {
  fixtureCounter += 1;
  return `${Date.now()}-${fixtureCounter}`;
}

function readStringByKey(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const map = payload as JsonMap;
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const value of Object.values(map)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = readStringByKey(value, keys);
      if (nested) return nested;
    }
  }
  return null;
}

async function createFreightEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[],
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false });
  const payload = await readJsonSafe(response);
  expect(response.ok(), `Failed POST ${path}: ${response.status()} ${JSON.stringify(payload)?.slice(0, 400)}`).toBeTruthy();
  const id = readStringByKey(payload, idKeys);
  expect(id, `No id in POST ${path} response`).toBeTruthy();
  return id as string;
}

export async function createTransportVehicleFixture(
  request: APIRequestContext,
  token: string,
  overrides: { status?: string } = {},
): Promise<string> {
  const suffix = uniqueFreightSuffix();
  return createFreightEntity(request, token, '/api/transport_operations/vehicles', {
    plateNumber: `QAFR-${suffix}`,
    vin: `VIN-${suffix}`.slice(0, 32),
    make: 'MAN',
    model: 'TGS',
    year: 2024,
    capacity: 25,
    status: overrides.status ?? 'active',
  }, ['id', 'vehicleId']);
}

export async function createTransportDriverFixture(
  request: APIRequestContext,
  token: string,
  overrides: { status?: string; licenseExpiry?: string } = {},
): Promise<string> {
  const suffix = uniqueFreightSuffix();
  return createFreightEntity(request, token, '/api/transport_operations/drivers', {
    fullName: `QA driver ${suffix}`,
    nationalId: `QAFR-${suffix}`,
    licenseNumber: `QALIC-${suffix}`,
    licenseExpiry: overrides.licenseExpiry ?? isoDate(90),
    phone: '+966500000001',
    status: overrides.status ?? 'available',
  }, ['id', 'driverId']);
}

export async function createFreightOrderFixture(
  request: APIRequestContext,
  token: string,
  input: FreightOrderFixtureInput,
): Promise<{ id: string; orderNumber: string | null }> {
  const id = await createFreightEntity(request, token, '/api/freight_operations/orders', {
    cargoDescription: input.cargoDescription ?? 'QA cargo',
    pickupLocation: input.pickupLocation ?? 'Riyadh',
    dropoffLocation: input.dropoffLocation ?? 'Dammam',
    agreedAmountNet: input.agreedAmountNet ?? '1000',
    ...(input.adjustmentAmountNet !== undefined ? { adjustmentAmountNet: input.adjustmentAmountNet } : {}),
    ...(input.vatRate !== undefined ? { vatRate: input.vatRate } : {}),
    ...(input.requestedPickupAt ? { requestedPickupAt: input.requestedPickupAt } : {}),
    ...(input.requestedDeliveryAt ? { requestedDeliveryAt: input.requestedDeliveryAt } : {}),
    ...(input.truckTypeRequired ? { truckTypeRequired: input.truckTypeRequired } : {}),
    customerId: input.customerId,
    customerSnapshot: input.customerSnapshot,
  }, ['id', 'orderId']);
  const order = await getFreightOrderFixture(request, token, id);
  const orderNumber = order && typeof order.order_number === 'string' ? order.order_number : null;
  return { id, orderNumber };
}

export async function getFreightOrderFixture(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<JsonMap | null> {
  const response = await apiRequest(request, 'GET', `/api/freight_operations/orders?ids=${encodeURIComponent(id)}&pageSize=1`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  if (!response.ok()) return null;
  return payload?.items?.[0] ?? null;
}

export async function runFreightOrderAction(
  request: APIRequestContext,
  token: string,
  id: string,
  action: 'confirm' | 'assign' | 'dispatch' | 'deliver' | 'complete' | 'cancel' | 'invoice',
  data: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; body: JsonMap | null }> {
  const response = await apiRequest(request, 'POST', `/api/freight_operations/orders/${action}`, {
    token,
    data: { id, ...data },
    retryTransport: false,
  });
  const body = await readJsonSafe<JsonMap>(response);
  return { ok: response.ok(), status: response.status(), body };
}

/**
 * Walk a confirmed-or-draft order through the full execution path to
 * `completed`, asserting each transition so a failure names the step.
 */
export async function advanceFreightOrderToCompleted(
  request: APIRequestContext,
  token: string,
  orderId: string,
  vehicleId: string,
  driverId: string,
): Promise<void> {
  const steps: Array<{ action: 'confirm' | 'assign' | 'dispatch' | 'deliver' | 'complete'; data?: Record<string, unknown> }> = [
    { action: 'confirm' },
    { action: 'assign', data: { vehicleId, driverId } },
    { action: 'dispatch' },
    { action: 'deliver', data: { podReference: `POD-${orderId.slice(0, 8)}` } },
    { action: 'complete' },
  ];
  for (const step of steps) {
    const result = await runFreightOrderAction(request, token, orderId, step.action, step.data ?? {});
    expect(result.ok, `order ${step.action} failed with ${result.status}: ${JSON.stringify(result.body)}`).toBeTruthy();
  }
}

export async function createFreightContractFixture(
  request: APIRequestContext,
  token: string,
  input: FreightContractFixtureInput,
): Promise<{ id: string; contractNumber: string | null }> {
  const id = await createFreightEntity(request, token, '/api/freight_operations/contracts', {
    customerId: input.customerId,
    customerSnapshot: input.customerSnapshot,
    title: input.title ?? `QA contract ${uniqueFreightSuffix()}`,
    validFrom: input.validFrom ?? isoDate(-30),
    validTo: input.validTo ?? isoDate(180),
    ...(input.requiresCustomerApproval !== undefined ? { requiresCustomerApproval: input.requiresCustomerApproval } : {}),
    ...(input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays } : {}),
  }, ['id', 'contractId']);
  const response = await apiRequest(request, 'GET', `/api/freight_operations/contracts?ids=${encodeURIComponent(id)}&pageSize=1`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  const contractNumber = payload?.items?.[0]?.contract_number;
  return { id, contractNumber: typeof contractNumber === 'string' ? contractNumber : null };
}

export async function activateFreightContractFixture(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  const response = await apiRequest(request, 'POST', '/api/freight_operations/contracts/activate', {
    token,
    data: { id },
    retryTransport: false,
  });
  expect(response.ok(), `Failed to activate contract: ${response.status()}`).toBeTruthy();
}

export async function createFreightContractRouteFixture(
  request: APIRequestContext,
  token: string,
  contractId: string,
  input: FreightContractRouteFixtureInput = {},
): Promise<string> {
  return createFreightEntity(request, token, '/api/freight_operations/contract-routes', {
    contractId,
    origin: input.origin ?? 'Riyadh',
    destination: input.destination ?? 'Dammam',
    rateBasis: input.rateBasis ?? 'per_trip',
    rateAmount: input.rateAmount ?? '450',
    ...(input.minimumCharge !== undefined ? { minimumCharge: input.minimumCharge } : {}),
    ...(input.lineNumber !== undefined ? { lineNumber: input.lineNumber } : {}),
  }, ['id', 'routeId']);
}

export async function createFreightTripFixture(
  request: APIRequestContext,
  token: string,
  input: FreightTripFixtureInput,
): Promise<string> {
  return createFreightEntity(request, token, '/api/freight_operations/trips', {
    contractId: input.contractId,
    contractRouteId: input.contractRouteId,
    executionDate: input.executionDate ?? isoDate(-1),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
  }, ['id', 'tripId']);
}

export async function getFreightTripFixture(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<JsonMap | null> {
  const response = await apiRequest(request, 'GET', `/api/freight_operations/trips?ids=${encodeURIComponent(id)}&pageSize=1`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  if (!response.ok()) return null;
  return payload?.items?.[0] ?? null;
}

export async function deleteFreightEntityIfExists(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token, retryTransport: false });
  } catch {
    // Cleanup must not mask the assertion that failed first.
  }
}

export function readNumericString(source: JsonMap | null | undefined, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Walk a planned trip to `delivered`, the state abstract generation requires.
 * The trip's POD gate only applies when `requirePodForBilling` is on (default
 * off), but the delivery carries a reference either way so the abstract's trips
 * look like the ones an operator records.
 */
export async function advanceFreightTripToDelivered(
  request: APIRequestContext,
  token: string,
  tripId: string,
): Promise<void> {
  const steps: Array<{ action: 'dispatch' | 'deliver'; data?: Record<string, unknown> }> = [
    { action: 'dispatch' },
    { action: 'deliver', data: { podReference: `POD-${tripId.slice(0, 8)}` } },
  ];
  for (const step of steps) {
    const response = await apiRequest(request, 'POST', `/api/freight_operations/trips/${step.action}`, {
      token,
      data: { id: tripId, ...(step.data ?? {}) },
      retryTransport: false,
    });
    const payload = await readJsonSafe(response);
    expect(
      response.ok(),
      `trip ${step.action} failed with ${response.status()}: ${JSON.stringify(payload)?.slice(0, 400)}`,
    ).toBeTruthy();
  }
}

export type FreightAbstractFixtureInput = {
  contractId: string;
  periodFrom?: string;
  periodTo?: string;
};

export async function generateFreightAbstractFixture(
  request: APIRequestContext,
  token: string,
  input: FreightAbstractFixtureInput,
): Promise<string> {
  return createFreightEntity(request, token, '/api/freight_operations/abstracts/generate', {
    contractId: input.contractId,
    periodFrom: input.periodFrom ?? isoDate(-30),
    periodTo: input.periodTo ?? isoDate(0),
  }, ['abstractId', 'id']);
}

export async function getFreightAbstractFixture(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<JsonMap | null> {
  const response = await apiRequest(request, 'GET', `/api/freight_operations/abstracts?ids=${encodeURIComponent(id)}&pageSize=1`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  if (!response.ok()) return null;
  return payload?.items?.[0] ?? null;
}

export async function getFreightAbstractLinesFixture(
  request: APIRequestContext,
  token: string,
  abstractId: string,
): Promise<JsonMap[]> {
  const response = await apiRequest(request, 'GET', `/api/freight_operations/abstracts/lines?id=${encodeURIComponent(abstractId)}`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  expect(response.ok(), `Failed to load abstract lines: ${response.status()}`).toBeTruthy();
  return payload?.items ?? [];
}

export type FreightAbstractAction =
  | 'submit'
  | 'respond'
  | 'resolve'
  | 'finalize'
  | 'record-offline-approval'
  | 'invoice'
  | 'cancel';

export async function runFreightAbstractAction(
  request: APIRequestContext,
  token: string,
  id: string,
  action: FreightAbstractAction,
  data: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; body: JsonMap | null }> {
  const response = await apiRequest(request, 'POST', `/api/freight_operations/abstracts/${action}`, {
    token,
    data: { id, ...data },
    retryTransport: false,
  });
  const body = await readJsonSafe<JsonMap>(response);
  return { ok: response.ok(), status: response.status(), body };
}

export async function getFreightPaymentRows(
  request: APIRequestContext,
  token: string,
  query: { abstractId?: string; orderId?: string },
): Promise<JsonMap[]> {
  const params = new URLSearchParams({ pageSize: '50' });
  if (query.abstractId) params.set('abstractId', query.abstractId);
  if (query.orderId) params.set('orderId', query.orderId);
  const response = await apiRequest(request, 'GET', `/api/freight_operations/payments?${params.toString()}`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[] }>(response);
  if (!response.ok()) return [];
  return payload?.items ?? [];
}
