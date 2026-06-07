import { expect, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest } from './api';
import { getTokenContext } from './generalFixtures';

export async function createCurrencyFixture(
  request: APIRequestContext,
  token: string,
  input: { code: string; name: string; symbol?: string },
): Promise<string> {
  const { organizationId, tenantId } = getTokenContext(token);
  const response = await apiRequest(request, 'POST', '/api/currencies/currencies', {
    token,
    data: { organizationId, tenantId, code: input.code, name: input.name, symbol: input.symbol ?? null },
  });
  expect(response.ok(), `Failed to create currency fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { id?: string };
  expect(typeof body.id === 'string' && body.id.length > 0).toBeTruthy();
  return body.id as string;
}

// Codes seeded by the currencies module (seedExampleCurrencies). Generated test
// codes avoid these so fixtures never collide with seeded rows.
const SEEDED_CURRENCY_CODES = new Set([
  'USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'CNY', 'CNH', 'PLN',
]);
// Reserved across the worker so two fixtures never draw the same code in one run.
const reservedCurrencyCodes = new Set<string>();

/** Draws an ISO-style three-letter code unused by seeds or earlier fixtures. */
export function generateUniqueCurrencyCode(): string {
  const letter = () => String.fromCharCode(65 + randomInt(26));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = `${letter()}${letter()}${letter()}`;
    if (!SEEDED_CURRENCY_CODES.has(code) && !reservedCurrencyCodes.has(code)) {
      reservedCurrencyCodes.add(code);
      return code;
    }
  }
  throw new Error('[internal] exhausted unique currency code space');
}

/**
 * Creates a currency with a generated unique code and returns its id and code.
 *
 * Currency DELETE is a soft delete, but the (organization, tenant, code) unique
 * constraint still counts soft-deleted rows — re-using a code an earlier test
 * soft-deleted makes the create fail. Drawing from the full three-letter space
 * (minus seeds) and retrying with a fresh code on an accidental collision keeps
 * fixture setup deterministic across runs that share a database.
 */
export async function createRandomCurrencyFixture(
  request: APIRequestContext,
  token: string,
  input: { name: string; symbol?: string; isActive?: boolean },
): Promise<{ id: string; code: string }> {
  const { organizationId, tenantId } = getTokenContext(token);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateUniqueCurrencyCode();
    const data: Record<string, unknown> = {
      organizationId,
      tenantId,
      code,
      name: input.name,
      symbol: input.symbol ?? null,
    };
    if (typeof input.isActive === 'boolean') data.isActive = input.isActive;
    const response = await apiRequest(request, 'POST', '/api/currencies/currencies', { token, data });
    if (response.status() === 201) {
      const body = (await response.json()) as { id?: string };
      if (typeof body.id === 'string' && body.id.length > 0) {
        return { id: body.id, code };
      }
    }
    lastStatus = response.status();
  }
  throw new Error(`[internal] failed to create currency fixture after retries (last status ${lastStatus})`);
}

export async function createFetchConfigFixture(
  request: APIRequestContext,
  token: string,
  input: { provider: string; isEnabled: boolean },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/currencies/fetch-configs', {
    token,
    data: input,
  });
  expect(response.ok(), `Failed to create fetch config fixture: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as { config?: { id?: string } };
  const id = body.config?.id;
  expect(typeof id === 'string' && id.length > 0).toBeTruthy();
  return id as string;
}

export async function deleteCurrenciesEntityIfExists(
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
