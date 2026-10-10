import { expect, type APIRequestContext } from '@playwright/test';
import { apiRequest } from './api';
import { readJsonSafe } from './generalFixtures';

/**
 * Shared fixture helpers for the app-local modules added on top of freight
 * (vehicle rentals, school transport). They follow the freight fixture
 * conventions: unique suffixes, API-created data, and a `finally`-friendly
 * delete that never masks an assertion.
 */

type JsonMap = Record<string, unknown>;

let fixtureCounter = 0;

export function uniqueModuleSuffix(): string {
  fixtureCounter += 1;
  return `${Date.now()}-${fixtureCounter}`;
}

export function isoDayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isoInstantOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
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

export async function createModuleEntity(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
  idKeys: string[] = ['id'],
): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false });
  const payload = await readJsonSafe(response);
  expect(response.ok(), `Failed POST ${path}: ${response.status()} ${JSON.stringify(payload)?.slice(0, 400)}`).toBeTruthy();
  const id = readStringByKey(payload, idKeys);
  expect(id, `No id in POST ${path} response`).toBeTruthy();
  return id as string;
}

export async function runModuleAction(
  request: APIRequestContext,
  token: string,
  path: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: JsonMap | null }> {
  const response = await apiRequest(request, 'POST', path, { token, data, retryTransport: false });
  const body = await readJsonSafe<JsonMap>(response);
  return { ok: response.ok(), status: response.status(), body };
}

export async function fetchModuleList(
  request: APIRequestContext,
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<{ items: JsonMap[]; total: number }> {
  const search = new URLSearchParams({ pageSize: '50', ...params });
  const response = await apiRequest(request, 'GET', `${path}?${search.toString()}`, { token });
  const payload = await readJsonSafe<{ items?: JsonMap[]; total?: number }>(response);
  if (!response.ok()) return { items: [], total: 0 };
  return { items: payload?.items ?? [], total: payload?.total ?? 0 };
}

export async function fetchModuleRow(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string,
): Promise<JsonMap | null> {
  const { items } = await fetchModuleList(request, token, path, { ids: id, pageSize: '1' });
  return items[0] ?? null;
}

export async function deleteModuleEntityIfExists(
  request: APIRequestContext,
  token: string,
  path: string,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  try {
    await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token, retryTransport: false });
  } catch {
    // Cleanup must never mask the assertion that failed first.
  }
}

export type CustomerSnapshotInput = {
  id: string;
  kind: 'company' | 'person';
  displayName: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
};

// ── Vehicle rentals ──────────────────────────────────────────────────────────

export async function createRentalContractFixture(
  request: APIRequestContext,
  token: string,
  input: {
    customerId: string;
    customerSnapshot: CustomerSnapshotInput;
    dailyRate?: string;
    includedKm?: number;
    extraKmRate?: string;
    rentalType?: string;
    startAt?: string;
    endAt?: string;
  },
): Promise<{ id: string; rentalNumber: string | null }> {
  const id = await createModuleEntity(request, token, '/api/vehicle_rentals/contracts', {
    customerId: input.customerId,
    customerSnapshot: input.customerSnapshot,
    rentalType: input.rentalType ?? 'with_driver',
    clientType: 'b2b',
    durationType: 'daily',
    startAt: input.startAt ?? isoInstantOffset(0),
    endAt: input.endAt ?? isoInstantOffset(3),
    dailyRate: input.dailyRate ?? '500',
    includedKm: input.includedKm ?? 300,
    extraKmRate: input.extraKmRate ?? '2',
  }, ['id', 'rentalId']);
  const row = await fetchModuleRow(request, token, '/api/vehicle_rentals/contracts', id);
  return { id, rentalNumber: row && typeof row.rental_number === 'string' ? row.rental_number : null };
}

// ── School transport ─────────────────────────────────────────────────────────

export async function createSubscriptionPlanFixture(
  request: APIRequestContext,
  token: string,
  input: { name?: string; priceTwoWay?: string; priceOneWay?: string } = {},
): Promise<string> {
  const suffix = uniqueModuleSuffix();
  return createModuleEntity(request, token, '/api/student_transport/plans', {
    name: input.name ?? `QA plan ${suffix}`,
    accountType: 'b2c',
    duration: 'monthly',
    priceTwoWay: input.priceTwoWay ?? '900',
    priceOneWay: input.priceOneWay ?? '520',
  });
}

export async function createStudentSubscriptionFixture(
  request: APIRequestContext,
  token: string,
  input: {
    customerId: string;
    customerSnapshot: CustomerSnapshotInput;
    planId?: string;
    studentName?: string;
    accountType?: string;
    direction?: string;
    schoolCustomerId?: string;
    schoolSnapshot?: CustomerSnapshotInput;
  },
): Promise<{ id: string; subscriptionNumber: string | null }> {
  const suffix = uniqueModuleSuffix();
  const id = await createModuleEntity(request, token, '/api/student_transport/subscriptions', {
    studentName: input.studentName ?? `QA student ${suffix}`,
    accountType: input.accountType ?? 'b2c',
    direction: input.direction ?? 'two_way',
    duration: 'monthly',
    ...(input.planId ? { planId: input.planId } : {}),
    customerId: input.customerId,
    customerSnapshot: input.customerSnapshot,
    ...(input.schoolCustomerId ? { schoolCustomerId: input.schoolCustomerId, schoolSnapshot: input.schoolSnapshot } : {}),
    startDate: isoDayOffset(-7),
  }, ['id', 'subscriptionId']);
  const row = await fetchModuleRow(request, token, '/api/student_transport/subscriptions', id);
  return { id, subscriptionNumber: row && typeof row.subscription_number === 'string' ? row.subscription_number : null };
}
