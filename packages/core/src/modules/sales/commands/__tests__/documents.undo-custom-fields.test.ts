/** @jest-environment node */

/**
 * Undo of an order/quote update restores header, line and adjustment custom
 * fields from the graph snapshot (issue #6449).
 *
 * Snapshots load custom fields through `loadCustomFieldValues`, which keys them
 * `cf_<key>`. The restore must write them back under the definition key `<key>`;
 * writing `cf_<key>` verbatim created a new EAV row and left `<key>` empty.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { E } from '#generated/entities.ids.generated'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
  findWithDecryption: jest.fn(async () => []),
}))

const setRecordCustomFieldsMock = jest.fn(async () => {})

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/entities/lib/helpers')
  return {
    ...actual,
    setRecordCustomFields: (...args: unknown[]) => setRecordCustomFieldsMock(...(args as [])),
  }
})

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const LINE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const ADJUSTMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

function makeEm() {
  const em: any = {
    fork: function () {
      return this
    },
    transactional: async (cb: (tx: unknown) => Promise<unknown>) => cb(em),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => {}),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
    getConnection: () => ({ execute: jest.fn(async () => [{ value: 1 }]) }),
  }
  return em
}

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    em: asValue(em),
    dataEngine: asValue({ markOrmEntityChange: jest.fn() }),
  })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
  }
}

function buildSnapshot(headerKey: 'order' | 'quote') {
  return {
    [headerKey]: {
      id: DOCUMENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      currencyCode: 'USD',
      customFields: { cf_k: 'B', cf_tags: ['x', 'y'] },
    },
    lines: [
      {
        id: LINE_ID,
        lineNumber: 1,
        kind: 'product',
        quantity: '1',
        currencyCode: 'USD',
        unitPriceNet: '10',
        unitPriceGross: '10',
        customFields: { cf_line_note: 'L' },
      },
    ],
    adjustments: [
      {
        id: ADJUSTMENT_ID,
        scope: 'order',
        kind: 'discount',
        amountNet: '1',
        amountGross: '1',
        currencyCode: 'USD',
        position: 0,
        customFields: { cf_reason: 'promo' },
      },
    ],
  }
}

async function runUndo(commandId: string, headerKey: 'order' | 'quote') {
  const handler = commandRegistry.get(commandId)!
  const em = makeEm()
  await handler.undo?.({
    logEntry: { commandPayload: { undo: { before: buildSnapshot(headerKey) } } },
    ctx: makeCtx(em),
    input: {},
  } as never)
  return em
}

function customFieldWritesByEntity() {
  const writes: Record<string, Record<string, unknown>> = {}
  for (const [, options] of setRecordCustomFieldsMock.mock.calls as unknown as Array<
    [unknown, { entityId: string; values: Record<string, unknown> }]
  >) {
    writes[options.entityId] = options.values
  }
  return writes
}

describe('order/quote update undo restores custom fields under their definition keys (#6449)', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../documents')
  })

  beforeEach(() => {
    setRecordCustomFieldsMock.mockClear()
  })

  it('strips the cf_ prefix from order header, line and adjustment custom fields', async () => {
    const em = await runUndo('sales.orders.update', 'order')

    expect(em.flush).toHaveBeenCalled()
    const writes = customFieldWritesByEntity()
    expect(writes[E.sales.sales_order]).toEqual({ k: 'B', tags: ['x', 'y'] })
    expect(writes[E.sales.sales_order_line]).toEqual({ line_note: 'L' })
    expect(writes[E.sales.sales_order_adjustment]).toEqual({ reason: 'promo' })
  })

  it('strips the cf_ prefix from quote header, line and adjustment custom fields', async () => {
    const em = await runUndo('sales.quotes.update', 'quote')

    expect(em.flush).toHaveBeenCalled()
    const writes = customFieldWritesByEntity()
    expect(writes[E.sales.sales_quote]).toEqual({ k: 'B', tags: ['x', 'y'] })
    expect(writes[E.sales.sales_quote_line]).toEqual({ line_note: 'L' })
    expect(writes[E.sales.sales_quote_adjustment]).toEqual({ reason: 'promo' })
  })
})
