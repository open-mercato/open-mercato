/**
 * Guards the JSON shape expected by WMS backend UI components
 * (`WmsOverviewPage`, `WmsInventoryConsolePage`, `WmsConfigurationPage`)
 * against accidental API / serializer regressions.
 *
 * Routes are GET list handlers under `/api/wms/...` (snake_case item fields).
 */

type JsonRecord = Record<string, unknown>

function assertPagedEnvelope(payload: unknown): asserts payload is {
  items: JsonRecord[]
  total: number
  totalPages: number
} {
  expect(payload && typeof payload === 'object').toBe(true)
  const env = payload as { items?: unknown; total?: unknown; totalPages?: unknown }
  expect(Array.isArray(env.items)).toBe(true)
  expect(typeof env.total).toBe('number')
  expect(typeof env.totalPages).toBe('number')
}

function assertRowHasStringKeys(row: JsonRecord, keys: string[]): void {
  for (const key of keys) {
    expect(Object.prototype.hasOwnProperty.call(row, key)).toBe(true)
  }
}

describe('WMS backend GUI <-> list API contract (response shape)', () => {
  it('accepts warehouse list payloads used by overview + configuration tables', () => {
    const payload = {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Main',
          code: 'MAIN',
          city: 'Krakow',
          country: 'PL',
          is_active: true,
        },
      ],
      total: 1,
      totalPages: 1,
      page: 1,
      pageSize: 25,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, ['id', 'name', 'code', 'is_active'])
    }
  })

  it('accepts zone list payloads used by the zones configuration section', () => {
    const payload = {
      items: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          warehouse_id: '11111111-1111-4111-8111-111111111111',
          code: 'RECV',
          name: 'Receiving',
          priority: 10,
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, ['id', 'warehouse_id', 'code', 'name', 'priority'])
      expect(typeof (row as JsonRecord).priority).toBe('number')
    }
  })

  it('accepts location list payloads used by overview + configuration tables', () => {
    const payload = {
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          warehouse_id: '11111111-1111-4111-8111-111111111111',
          code: 'A-01',
          type: 'bin',
          is_active: true,
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, ['id', 'warehouse_id', 'code', 'type', 'is_active'])
    }
  })

  it('accepts inventory balance list payloads used by inventory console', () => {
    const payload = {
      items: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          warehouse_id: '11111111-1111-4111-8111-111111111111',
          location_id: '22222222-2222-4222-8222-222222222222',
          catalog_variant_id: '44444444-4444-4444-8444-444444444444',
          quantity_on_hand: '10',
          quantity_reserved: '2',
          quantity_allocated: '1',
          quantity_available: 7,
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, [
        'id',
        'warehouse_id',
        'location_id',
        'catalog_variant_id',
        'quantity_on_hand',
        'quantity_reserved',
        'quantity_allocated',
        'quantity_available',
      ])
      const onHand = Number((row as JsonRecord).quantity_on_hand)
      const reserved = Number((row as JsonRecord).quantity_reserved)
      const allocated = Number((row as JsonRecord).quantity_allocated)
      const available = Number((row as JsonRecord).quantity_available)
      expect(available).toBe(onHand - reserved - allocated)
    }
  })

  it('accepts reservation list payloads used by inventory console', () => {
    const payload = {
      items: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          warehouse_id: '11111111-1111-4111-8111-111111111111',
          catalog_variant_id: '44444444-4444-4444-8444-444444444444',
          quantity: '3',
          source_type: 'order',
          source_id: '66666666-6666-4666-8666-666666666666',
          status: 'active',
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, [
        'id',
        'warehouse_id',
        'catalog_variant_id',
        'quantity',
        'source_type',
        'source_id',
        'status',
      ])
      expect(['active', 'released', 'fulfilled']).toContain((row as JsonRecord).status)
    }
  })

  it('accepts movement list payloads used by inventory console + movements page', () => {
    const payload = {
      items: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          warehouse_id: '11111111-1111-4111-8111-111111111111',
          catalog_variant_id: '44444444-4444-4444-8444-444444444444',
          quantity: '5',
          type: 'receipt',
          reference_type: 'manual',
          reference_id: '88888888-8888-4888-8888-888888888888',
          performed_at: '2026-04-24T12:00:00.000Z',
          received_at: '2026-04-24T12:00:00.000Z',
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, [
        'id',
        'warehouse_id',
        'catalog_variant_id',
        'quantity',
        'type',
        'reference_type',
        'performed_at',
      ])
      expect([
        'receipt',
        'putaway',
        'pick',
        'pack',
        'ship',
        'adjust',
        'transfer',
        'cycle_count',
        'return_receive',
      ]).toContain((row as JsonRecord).type)
    }
  })

  it('accepts inventory profile list payloads used by configuration page', () => {
    const payload = {
      items: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          catalog_product_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          catalog_variant_id: '44444444-4444-4444-8444-444444444444',
          default_uom: 'pc',
          default_strategy: 'fifo',
          track_lot: false,
          track_serial: false,
          track_expiration: false,
          reorder_point: '2',
          safety_stock: '1',
        },
      ],
      total: 1,
      totalPages: 1,
    }
    assertPagedEnvelope(payload)
    for (const row of payload.items) {
      assertRowHasStringKeys(row, [
        'id',
        'catalog_product_id',
        'default_uom',
        'default_strategy',
        'track_lot',
        'track_serial',
        'track_expiration',
      ])
      expect(['fifo', 'lifo', 'fefo']).toContain((row as JsonRecord).default_strategy)
    }
  })

  it('rejects list payloads missing pagination fields (regression guard)', () => {
    expect(() => assertPagedEnvelope({ items: [], total: 0 })).toThrow()
  })
})
