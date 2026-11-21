/** @jest-environment node */

/**
 * `sales.orders.update` and `sales.quotes.update` log the columns an update names. Their snapshots
 * are built through `cloneJson`, so every object column (`customerSnapshot`, the address and method
 * snapshots, `customFields`, `metadata`) is a new object on both sides: compared by reference it was
 * listed as changed on every update that named it, whatever its value. These pin the comparison by
 * value: an unchanged object column is not listed, and a changed one still is.
 */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { createContainer, asValue, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
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
    comments: 'Stored comment',
    customFields: { source: 'integration' },
    updatedAt: '2026-11-16T10:00:00.000Z',
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
  comment: 'Stored comment',
  customFields: { source: 'integration' },
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
  afterEach(() => jest.restoreAllMocks())

  it('lists no object column whose value did not change', async () => {
    expect(await loggedChanges(commandId, RESENT_INPUT)).toBeNull()
  })

  it('lists an object column whose value changed', async () => {
    const changes = await loggedChanges(commandId, RESENT_INPUT, {
      paymentMethodSnapshot: { id: METHOD_ID, code: 'card', name: 'Card' },
    })
    expect(Object.keys(changes ?? {})).toEqual(['paymentMethodSnapshot'])
  })

  async function executeWithSnapshots(
    afterOverrides: Record<string, unknown> = {},
    graphOverrides: Record<string, unknown> = {},
    inputOverrides: Record<string, unknown> = {},
    withBefore = true,
  ) {
    const key = commandId === 'sales.orders.update' ? 'order' : 'quote'
    const handler = commandRegistry.get(commandId)!
    const before = { [key]: documentSnapshot(), tags: [], lines: [], adjustments: [] }
    const after = {
      ...before,
      [key]: documentSnapshot({ updatedAt: '2026-11-16T10:00:01.000Z', ...afterOverrides }),
      ...graphOverrides,
    }
    const result = { [key]: after[key] }
    jest.spyOn(handler, 'prepare').mockResolvedValue(withBefore ? { before } : {})
    const execute = jest.spyOn(handler, 'execute').mockImplementation(async (input, ctx) => {
      await ctx.beforeTransactionalWrite?.({} as EntityManager, input)
      return result
    })
    jest.spyOn(handler, 'captureAfter').mockResolvedValue(after)
    const log = jest.fn(async (payload: Record<string, unknown>) => payload)
    const flushOrmEntityChanges = jest.fn()
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log }),
      dataEngine: asValue({ flushOrmEntityChanges }),
    })
    const bus = new CommandBus()
    const run = () => bus.execute(commandId, {
      input: { ...RESENT_INPUT, ...inputOverrides },
      ctx: {
        container,
        auth: { sub: DOCUMENT_ID, tenantId: TENANT_ID, orgId: ORG_ID },
        selectedOrganizationId: ORG_ID,
        organizationScope: null,
        organizationIds: null,
      },
    })
    await run()
    return { log, execute, flushOrmEntityChanges, before, after, run }
  }

  it('does not persist a whole-document diff for repeated unchanged saves through the command bus', async () => {
    const { log, execute, flushOrmEntityChanges, run } = await executeWithSnapshots()
    await run()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(flushOrmEntityChanges).toHaveBeenCalledTimes(2)
    expect(log).not.toHaveBeenCalled()
  })

  it('persists real comment changes with full versioned snapshots and undo data', async () => {
    const { log, before, after } = await executeWithSnapshots(
      { comments: 'Changed comment' }, {}, { comment: 'Changed comment' },
    )
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatchObject({
      changes: { comments: { from: 'Stored comment', to: 'Changed comment' } },
      snapshotBefore: before,
      snapshotAfter: after,
      commandPayload: { undo: { before, after } },
    })
    expect(Object.keys(log.mock.calls[0][0].changes as object)).toEqual(['comments'])
    const key = commandId === 'sales.orders.update' ? 'order' : 'quote'
    expect(before[key].updatedAt).toBe('2026-11-16T10:00:00.000Z')
    expect(after[key].updatedAt).toBe('2026-11-16T10:00:01.000Z')
  })

  it('persists changed object columns through the command bus', async () => {
    const { log } = await executeWithSnapshots({ metadata: { source: { id: 8 } } })
    expect(log.mock.calls[0][0].changes).toEqual({
      metadata: { from: { source: { id: 7 } }, to: { source: { id: 8 } } },
    })
  })

  it('preserves inference for custom-field-only changes', async () => {
    const { log } = await executeWithSnapshots({ customFields: { source: 'edited' } })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0].changes).toBeTruthy()
  })

  it('does not ignore updatedAt stored inside business JSON', async () => {
    const metadata = { source: { id: 7, updatedAt: '2026-11-17T10:00:00.000Z' } }
    const { log } = await executeWithSnapshots({ metadata })
    expect(log.mock.calls[0][0].changes).toEqual({
      metadata: { from: { source: { id: 7 } }, to: metadata },
    })
  })

  it('preserves inference for recalculated totals without a selected column change', async () => {
    const { log } = await executeWithSnapshots({ grandTotalGrossAmount: '42.00' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0].changes).toBeTruthy()
  })

  it('preserves graph changes even when document columns are unchanged', async () => {
    const { log } = await executeWithSnapshots({}, { lines: [{ id: METHOD_ID, quantity: '2' }] })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0].changes).toHaveProperty('lines')
  })

  it('persists tag-only changes', async () => {
    const { log } = await executeWithSnapshots(
      {}, { tags: [{ tagId: METHOD_ID }] }, { tags: [METHOD_ID] },
    )
    expect(log.mock.calls[0][0].changes).toEqual({ tags: { from: [], to: [METHOD_ID] } })
  })

  it('keeps logging when the before snapshot is unavailable', async () => {
    const { log } = await executeWithSnapshots({}, {}, {}, false)
    expect(log).toHaveBeenCalledTimes(1)
  })
})
