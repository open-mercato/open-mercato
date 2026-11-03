import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
  generateUniqueCurrencyCode,
} from '@open-mercato/core/helpers/integration/currenciesFixtures'

test.describe('TC-CUR-016: Create scope from the authenticated request', () => {
  test('creates a currency without browser scope and persists the authenticated scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    let currencyId: string | null = null
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await apiRequest(request, 'POST', '/api/currencies/currencies', {
          token, data: { code: generateUniqueCurrencyCode(), name: 'QA Uninitialized Scope' },
        })
        const body = await response.json() as { id?: string; error?: string }
        const codeCollision = response.status() === 409
          && body.error === 'Currency code already exists for this organization.'
        if (codeCollision && attempt < 7) continue
        expect(response.status()).toBe(201)
        currencyId = body.id ?? null
        break
      }
      expect(currencyId).toBeTruthy()
      const read = await apiRequest(request, 'GET', `/api/currencies/currencies?id=${currencyId}`, { token })
      expect(read.status()).toBe(200)
      const result = await read.json() as { items: Array<Record<string, unknown>> }
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ id: currencyId, ...scope })
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId)
    }
  })

  test('creates an exchange rate without browser scope and persists the authenticated scope', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenContext(token)
    let fromId: string | null = null
    let toId: string | null = null
    let rateId: string | null = null
    try {
      const from = await createRandomCurrencyFixture(request, token, { name: 'QA Scope From' })
      fromId = from.id
      const to = await createRandomCurrencyFixture(request, token, { name: 'QA Scope To' })
      toId = to.id
      const response = await apiRequest(request, 'POST', '/api/currencies/exchange-rates', {
        token, data: {
          fromCurrencyCode: from.code, toCurrencyCode: to.code,
          rate: '1.25000000', date: new Date().toISOString(), source: 'QA-Scope',
        },
      })
      expect(response.status()).toBe(201)
      const body = await response.json() as { id: string }
      rateId = body.id
      expect(rateId).toBeTruthy()
      const read = await apiRequest(request, 'GET', `/api/currencies/exchange-rates?id=${rateId}`, { token })
      expect(read.status()).toBe(200)
      const result = await read.json() as { items: Array<Record<string, unknown>> }
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({ id: rateId, ...scope })
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/exchange-rates', rateId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', toId)
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', fromId)
    }
  })

  for (const resource of ['currencies', 'exchange-rates']) {
    test(`rejects explicit unauthorized tenant selection for ${resource}`, async ({ request }) => {
      const token = await getAuthToken(request, 'admin')
      const fields = resource === 'currencies'
        ? { code: generateUniqueCurrencyCode(), name: 'QA Forbidden Scope' }
        : {
            fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.25000000',
            date: new Date().toISOString(), source: 'QA-Scope',
          }
      for (const explicitScope of [
        { tenantId: randomUUID() },
        { tenantId: null },
      ]) {
        const response = await apiRequest(request, 'POST', `/api/currencies/${resource}`, {
          token, data: { ...fields, ...explicitScope },
        })
        expect(response.status(), `Explicit tenant selection ${String(explicitScope.tenantId)} must be rejected`).toBe(403)
      }
    })
  }
})
