import { test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { generateUniqueCurrencyCode } from '@open-mercato/core/helpers/integration/currenciesFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  runCrudUndoRoundTrip,
  skipIfUndoTestsDisabled,
} from '@open-mercato/core/helpers/integration/undoHarness'

function uniqueRateDate(stamp: string): string {
  const hash = Array.from(stamp).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const seconds = (Number(stamp.replace(/\D/g, '').slice(-8)) + hash) % 86_400
  return new Date(Date.UTC(2040, 0, 1, 0, 0, seconds)).toISOString()
}

/**
 * TC-UNDO-001 currencies (#2579).
 *
 * Covers currencies and exchange-rate undo/redo. The duplicate exchange-rate
 * 409 contract remains quarantined under #2506.
 */
test.describe('TC-UNDO-001 currencies undo/redo', () => {
  test.beforeAll(() => {
    skipIfUndoTestsDisabled()
  })

  test('currencies CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)

    await runCrudUndoRoundTrip(request, token, {
      label: 'currencies.currencies',
      collectionPath: '/api/currencies/currencies',
      field: 'name',
      createPayload: (stamp) => ({
        organizationId,
        tenantId,
        code: generateUniqueCurrencyCode(),
        name: `Undo Currency ${stamp}`,
      }),
      updatePayload: (id, stamp) => ({
        id,
        organizationId,
        tenantId,
        name: `Undo Currency Renamed ${stamp}`,
      }),
    })
  })

  test('exchange rates CRUD commands restore scalar state on undo/redo', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(token)

    await runCrudUndoRoundTrip(request, token, {
      label: 'currencies.exchangeRates',
      collectionPath: '/api/currencies/exchange-rates',
      field: 'rate',
      createPayload: (stamp) => ({
        organizationId,
        tenantId,
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '1.05',
        date: uniqueRateDate(stamp),
        source: `undo-${stamp}`,
      }),
      updatePayload: (id) => ({
        id,
        organizationId,
        tenantId,
        rate: '1.10',
      }),
    })
  })

  test.fixme('duplicate exchange-rate create returns 409 instead of 500 — #2506', async () => {
    // Quarantined until the product contract is fixed in #2506.
  })
})
