/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (emInstance: { findOne: (...args: unknown[]) => unknown }, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
  findWithDecryption: (emInstance: { find: (...args: unknown[]) => unknown }, entity: unknown, filters: unknown) =>
    emInstance.find(entity, filters),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const WAREHOUSE_ID = '33333333-3333-4333-8333-333333333333'
const ZONE_ID = '44444444-4444-4444-8444-444444444444'
const ZONE_ENTITY_ID = 'wms:warehouse_zone'

type ZoneRecord = {
  id: string
  organizationId: string
  tenantId: string
  warehouse: { id: string }
  code: string
  name: string
  priority: number
  metadata: unknown
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

type CustomFieldValueRow = {
  recordId: string
  fieldKey: string
  organizationId: string | null
  tenantId: string | null
  valueText: string | null
  valueMultiline: string | null
  valueInt: number | null
  valueFloat: number | null
  valueBool: boolean | null
}

type SetCustomFieldsCall = {
  entityId: string
  recordId: string
  organizationId: string | null
  tenantId: string | null
  values: Record<string, unknown>
  notify?: boolean
}

type IndexChange = {
  action: string
  identifiers: { id: string; organizationId: string | null; tenantId: string | null }
  indexerEntityType?: string
}

function textValueRow(fieldKey: string, value: string): CustomFieldValueRow {
  return {
    recordId: ZONE_ID,
    fieldKey,
    organizationId: ORG,
    tenantId: TENANT,
    valueText: value,
    valueMultiline: null,
    valueInt: null,
    valueFloat: null,
    valueBool: null,
  }
}

function zoneRecord(overrides: Partial<ZoneRecord> = {}): ZoneRecord {
  return {
    id: ZONE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    warehouse: { id: WAREHOUSE_ID },
    code: 'PICK',
    name: 'Pick face',
    priority: 5,
    metadata: null,
    deletedAt: null,
    createdAt: new Date('2026-04-15T00:00:00.000Z'),
    updatedAt: new Date('2026-04-16T00:00:00.000Z'),
    ...overrides,
  }
}

function zoneSnapshot(custom?: Record<string, unknown>) {
  return {
    id: ZONE_ID,
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: WAREHOUSE_ID,
    code: 'PICK',
    name: 'Pick face',
    priority: 5,
    metadata: null,
    ...(custom ? { custom } : {}),
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

/**
 * Minimal em + container stub covering the lookups the zone commands make. `findOne`
 * routes on the filter shape because the commands go through `findOneWithDecryption`,
 * which the mock above collapses onto `em.findOne(entity, filters)` with the entity
 * class carried opaquely.
 */
function createZoneHarness(options: { zone?: ZoneRecord | null; customFieldValues?: CustomFieldValueRow[] } = {}) {
  const zone = options.zone === undefined ? zoneRecord() : options.zone
  const customFieldValues = options.customFieldValues ?? []
  const created: ZoneRecord[] = []
  const setCustomFieldsCalls: SetCustomFieldsCall[] = []
  const indexChanges: IndexChange[] = []

  const em: Record<string, jest.Mock> = {
    findOne: jest.fn(async (_entity: unknown, filters: Record<string, unknown>) => {
      if (filters.code !== undefined && filters.warehouse !== undefined) return null
      if (filters.id === WAREHOUSE_ID) {
        return { id: WAREHOUSE_ID, organizationId: ORG, tenantId: TENANT, deletedAt: null }
      }
      if (filters.id === ZONE_ID) return zone
      return null
    }),
    find: jest.fn(async (_entity: unknown, filters: Record<string, unknown>) => {
      if (filters.recordId !== undefined) return customFieldValues
      if (filters.key !== undefined) {
        const keys = (filters.key as { $in?: string[] })?.$in ?? []
        return keys.map((key) => ({
          key,
          kind: 'text',
          entityId: ZONE_ENTITY_ID,
          organizationId: ORG,
          tenantId: TENANT,
          isActive: true,
          deletedAt: null,
          configJson: null,
        }))
      }
      return []
    }),
    create: jest.fn((_entity: unknown, data: Partial<ZoneRecord>) => {
      const record = {
        ...zoneRecord(),
        ...data,
        id: data.id ?? ZONE_ID,
      } as ZoneRecord
      created.push(record)
      return record
    }),
    persist: jest.fn(() => em),
    flush: jest.fn(async () => undefined),
  }

  const dataEngine = {
    setCustomFields: jest.fn(async (opts: SetCustomFieldsCall) => {
      setCustomFieldsCalls.push(opts)
    }),
    markOrmEntityChange: jest.fn((opts: { action: string; identifiers: IndexChange['identifiers']; indexer?: { entityType?: string } }) => {
      indexChanges.push({
        action: opts.action,
        identifiers: opts.identifiers,
        indexerEntityType: opts.indexer?.entityType,
      })
    }),
  }

  const ctx = {
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'dataEngine') return dataEngine
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  }

  return { em, ctx, dataEngine, created, setCustomFieldsCalls, indexChanges }
}

describe('WMS zone commands — custom fields', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('create writes the submitted custom fields against the canonical zone entity id', async () => {
    const handler = commandRegistry.get('wms.zones.create')!
    const harness = createZoneHarness({ zone: null })

    await handler.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        code: 'Z1',
        name: 'Zone 1',
        priority: 3,
        customFields: { zone_note: 'Pick face' },
      } as never,
      harness.ctx as never,
    )

    expect(harness.setCustomFieldsCalls).toHaveLength(1)
    expect(harness.setCustomFieldsCalls[0]).toMatchObject({
      entityId: ZONE_ENTITY_ID,
      recordId: ZONE_ID,
      organizationId: ORG,
      tenantId: TENANT,
      values: { zone_note: 'Pick face' },
      notify: false,
    })
  })

  // Regression guard for #5239: the zones list is served by the hybrid query engine,
  // which projects `cf:*` out of `entity_indexes`. Without this side effect the value
  // written above is stored but unreadable, which is exactly how the feature shipped broken.
  it('create queues a query-index upsert for the zone so the written values become readable', async () => {
    const handler = commandRegistry.get('wms.zones.create')!
    const harness = createZoneHarness({ zone: null })

    await handler.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        code: 'Z1',
        name: 'Zone 1',
        customFields: { zone_note: 'Pick face' },
      } as never,
      harness.ctx as never,
    )

    expect(harness.indexChanges).toEqual([
      {
        action: 'created',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
    expect(harness.dataEngine.setCustomFields.mock.invocationCallOrder[0])
      .toBeLessThan(harness.dataEngine.markOrmEntityChange.mock.invocationCallOrder[0])
  })

  it('create without custom fields does not touch the custom field store', async () => {
    const handler = commandRegistry.get('wms.zones.create')!
    const harness = createZoneHarness({ zone: null })

    await handler.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WAREHOUSE_ID,
        code: 'Z1',
        name: 'Zone 1',
      } as never,
      harness.ctx as never,
    )

    expect(harness.dataEngine.setCustomFields).not.toHaveBeenCalled()
    expect(harness.indexChanges).toHaveLength(1)
  })

  it('update writes the submitted custom fields and reindexes the zone', async () => {
    const handler = commandRegistry.get('wms.zones.update')!
    const harness = createZoneHarness()

    await handler.execute(
      { id: ZONE_ID, name: 'Renamed', customFields: { zone_note: 'Bulk store' } } as never,
      harness.ctx as never,
    )

    expect(harness.setCustomFieldsCalls).toHaveLength(1)
    expect(harness.setCustomFieldsCalls[0]).toMatchObject({
      entityId: ZONE_ENTITY_ID,
      recordId: ZONE_ID,
      values: { zone_note: 'Bulk store' },
      notify: false,
    })
    expect(harness.indexChanges).toEqual([
      {
        action: 'updated',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
  })

  it('update without custom fields leaves existing values untouched', async () => {
    const handler = commandRegistry.get('wms.zones.update')!
    const harness = createZoneHarness()

    await handler.execute({ id: ZONE_ID, name: 'Renamed' } as never, harness.ctx as never)

    expect(harness.dataEngine.setCustomFields).not.toHaveBeenCalled()
  })

  it('undo of create nulls exactly the keys the created record held', async () => {
    const handler = commandRegistry.get('wms.zones.create')!
    const harness = createZoneHarness()

    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { after: zoneSnapshot({ zone_note: 'Pick face', zone_tags: ['a', 'b'] }) } } } as never,
      ctx: harness.ctx as never,
      undoToken: 'token-create-undo',
    } as never)

    expect(harness.setCustomFieldsCalls).toHaveLength(1)
    expect(harness.setCustomFieldsCalls[0].values).toEqual({ zone_note: null, zone_tags: [] })
    expect(harness.indexChanges).toEqual([
      {
        action: 'deleted',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
  })

  it('undo of update restores before-values and clears keys the update introduced', async () => {
    const handler = commandRegistry.get('wms.zones.update')!
    const harness = createZoneHarness()

    await handler.undo!({
      input: {},
      logEntry: {
        commandPayload: {
          undo: {
            before: zoneSnapshot({ zone_note: 'Pick face' }),
            after: zoneSnapshot({ zone_note: 'Bulk store', zone_owner: 'ops' }),
          },
        },
      } as never,
      ctx: harness.ctx as never,
      undoToken: 'token-update-undo',
    } as never)

    expect(harness.setCustomFieldsCalls).toHaveLength(1)
    expect(harness.setCustomFieldsCalls[0].values).toEqual({ zone_note: 'Pick face', zone_owner: null })
    expect(harness.indexChanges).toEqual([
      {
        action: 'updated',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
  })

  it('undo of delete restores the custom field values the deleted zone carried', async () => {
    const handler = commandRegistry.get('wms.zones.delete')!
    const harness = createZoneHarness({ zone: zoneRecord({ deletedAt: new Date('2026-04-20T00:00:00.000Z') }) })

    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before: zoneSnapshot({ zone_note: 'Pick face' }) } } } as never,
      ctx: harness.ctx as never,
      undoToken: 'token-delete-undo',
    } as never)

    expect(harness.setCustomFieldsCalls).toHaveLength(1)
    expect(harness.setCustomFieldsCalls[0].values).toEqual({ zone_note: 'Pick face' })
    expect(harness.indexChanges).toEqual([
      {
        action: 'created',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
  })

  it('delete removes the zone from the query index', async () => {
    const handler = commandRegistry.get('wms.zones.delete')!
    const harness = createZoneHarness()

    await handler.execute({ id: ZONE_ID } as never, harness.ctx as never)

    expect(harness.indexChanges).toEqual([
      {
        action: 'deleted',
        identifiers: { id: ZONE_ID, organizationId: ORG, tenantId: TENANT },
        indexerEntityType: ZONE_ENTITY_ID,
      },
    ])
  })

  it('the snapshot loader captures custom values under bare, un-prefixed keys', async () => {
    const handler = commandRegistry.get('wms.zones.update')!
    const harness = createZoneHarness({ customFieldValues: [textValueRow('zone_note', 'Pick face')] })

    const prepared = (await handler.prepare!({ id: ZONE_ID } as never, harness.ctx as never)) as {
      before?: { custom?: Record<string, unknown> }
    }

    expect(prepared.before?.custom).toEqual({ zone_note: 'Pick face' })
  })
})
