/** @jest-environment node */

/**
 * `sales.orders.update` and `sales.quotes.update` log the columns an update names. Their snapshots
 * are built through `cloneJson`, so every object column (`customerSnapshot`, the address and method
 * snapshots, `customFields`, `metadata`) is a new object on both sides: compared by reference it was
 * listed as changed on every update that named it, whatever its value. These pin the comparison by
 * value: an unchanged object column is not listed, and a changed one still is.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import '../documents'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const METHOD_ID = '44444444-4444-4444-8444-444444444444'

/** A fresh copy on every call, as `loadOrderSnapshot` / `loadQuoteSnapshot` produce one. */
function documentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: DOCUMENT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    customerSnapshot: { customer: { displayName: 'Customer' } },
    billingAddressSnapshot: { addressLine1: 'Street 1', city: 'City' },
    shippingAddressSnapshot: { addressLine1: 'Street 1', city: 'City' },
    paymentMethodSnapshot: { id: METHOD_ID, code: 'transfer', name: 'Transfer' },
    metadata: { source: { id: 7 } },
    ...overrides,
  }
}

/** The input a re-sync sends: every object column, with the values already stored. */
const RESENT_INPUT = {
  id: DOCUMENT_ID,
  customerSnapshot: { customer: { displayName: 'Customer' } },
  billingAddressSnapshot: { addressLine1: 'Street 1', city: 'City' },
  shippingAddressSnapshot: { addressLine1: 'Street 1', city: 'City' },
  paymentMethodSnapshot: { id: METHOD_ID, code: 'transfer', name: 'Transfer' },
  metadata: { source: { id: 7 } },
}

async function loggedChanges(
  commandId: 'sales.orders.update' | 'sales.quotes.update',
  input: Record<string, unknown>,
  afterOverrides: Record<string, unknown> = {},
) {
  const key = commandId === 'sales.orders.update' ? 'order' : 'quote'
  const handler = commandRegistry.get(commandId)
  expect(handler).toBeTruthy()
  const before = { [key]: documentSnapshot(), tags: [] }
  const after = { [key]: documentSnapshot(afterOverrides), tags: [] }
  const log = await handler!.buildLog?.({
    input,
    snapshots: { before, after },
    result: { [key]: after[key] },
  } as never)
  return log?.changes ?? null
}

describe.each(['sales.orders.update', 'sales.quotes.update'] as const)('%s audit changes', (commandId) => {
  it('lists no object column whose value did not change', async () => {
    expect(await loggedChanges(commandId, RESENT_INPUT)).toBeNull()
  })

  it('lists an object column whose value changed', async () => {
    const changes = await loggedChanges(commandId, RESENT_INPUT, {
      paymentMethodSnapshot: { id: METHOD_ID, code: 'card', name: 'Card' },
    })
    expect(Object.keys(changes ?? {})).toEqual(['paymentMethodSnapshot'])
  })
})
