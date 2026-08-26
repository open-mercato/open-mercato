import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

/**
 * TC-SALES-5604: the document-number counter reported by the settings API must be the one the
 * next claim actually returns.
 *
 * The unit suite mocks the Postgres connection, so it cannot see the state that broke this:
 * `setNextSequence` armed the sequence with `is_called = false`, and `pg_sequence_last_value`
 * answers NULL for exactly that state, so every reader fell back to the start value. The form
 * posts back what it displays, so the next save wrote that rewind into the sequence and the
 * generator re-issued numbers existing orders already carried.
 *
 * The sequence only ever moves forward here — the spec parks it well ahead of whatever the
 * tenant is using and leaves it there, so nothing it does can hand a later test a number that
 * is already on a document.
 */

const SETTINGS_PATH = '/api/sales/settings/document-numbers'

type Settings = {
  orderNumberFormat: string
  quoteNumberFormat: string
  nextOrderNumber: number
  nextQuoteNumber: number
}

test.describe('TC-SALES-5604: document numbering settings round-trip', () => {
  test('reports the counter it was set to, and keeps it across a re-save', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')

    const initialResponse = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
    test.skip(
      !initialResponse.ok(),
      `Sales numbering settings are unavailable in this environment (${initialResponse.status()})`
    )
    const initial = await readJsonSafe<Settings>(initialResponse)
    expect(typeof initial?.nextOrderNumber).toBe('number')

    const save = async (orderNextNumber: number) => {
      const response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token,
        data: {
          orderNumberFormat: initial!.orderNumberFormat,
          quoteNumberFormat: initial!.quoteNumberFormat,
          orderNextNumber,
        },
      })
      expect(response.ok(), `Saving numbering settings failed: ${response.status()}`).toBeTruthy()
      return (await readJsonSafe<Settings>(response))!
    }

    const read = async () => {
      const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
      expect(response.ok(), `Reading numbering settings failed: ${response.status()}`).toBeTruthy()
      return (await readJsonSafe<Settings>(response))!
    }

    const claim = async () => {
      const response = await apiRequest(request, 'POST', '/api/sales/document-numbers', {
        token,
        data: { kind: 'order' },
      })
      expect(response.ok(), `Claiming an order number failed: ${response.status()}`).toBeTruthy()
      return (await readJsonSafe<{ sequence?: number }>(response))!.sequence
    }

    const target = initial!.nextOrderNumber + 10_000

    expect(
      (await save(target)).nextOrderNumber,
      'The save response must report the counter that was just saved'
    ).toBe(target)
    expect((await read()).nextOrderNumber, 'A reload must report the saved counter').toBe(target)

    expect(await claim(), 'The next claim must return the counter the settings page showed').toBe(target)
    expect((await read()).nextOrderNumber, 'After a claim the counter must advance by one').toBe(target + 1)

    // The settings form posts back whatever the API reported, so a re-save of an unchanged
    // page must be a no-op rather than a rewind of the whole series.
    const reported = (await read()).nextOrderNumber
    await save(reported)
    expect((await read()).nextOrderNumber, 'A no-op re-save must not move the counter').toBe(reported)
    expect(await claim(), 'A no-op re-save must not re-issue a number already claimed').toBe(reported)
  })
})
