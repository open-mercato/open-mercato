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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (emInstance: any, entity: unknown, filters: unknown) =>
    emInstance.findOne(entity, filters),
}))

const TENANT = 'tenant-1'
const ORG = 'org-1'

function warehouseSnapshot() {
  return {
    id: 'wh-1',
    organizationId: ORG,
    tenantId: TENANT,
    name: 'Main DC',
    code: 'MAIN',
    isActive: true,
    addressLine1: '1 Loading Dock',
    city: 'Warsaw',
    postalCode: '00-001',
    country: 'PL',
    timezone: 'Europe/Warsaw',
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

function zoneSnapshot() {
  return {
    id: 'zone-1',
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: 'wh-1',
    code: 'PICK',
    name: 'Pick face',
    priority: 5,
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

function locationSnapshot() {
  return {
    id: 'loc-1',
    organizationId: ORG,
    tenantId: TENANT,
    warehouseId: 'wh-1',
    parentId: null,
    code: 'A1-B1',
    type: 'bin',
    isActive: true,
    capacityUnits: '100',
    capacityWeight: '500',
    constraints: null,
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

function profileSnapshot() {
  return {
    id: 'profile-1',
    organizationId: ORG,
    tenantId: TENANT,
    catalogProductId: 'product-1',
    catalogVariantId: 'variant-1',
    defaultUom: 'pcs',
    trackLot: true,
    trackSerial: false,
    trackExpiration: true,
    defaultStrategy: 'fefo',
    reorderPoint: '20',
    safetyStock: '5',
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

function lotSnapshot() {
  return {
    id: 'lot-1',
    organizationId: ORG,
    tenantId: TENANT,
    catalogVariantId: 'variant-1',
    sku: 'SKU-1',
    lotNumber: 'L-001',
    batchNumber: 'B-001',
    manufacturedAt: '2026-04-01T00:00:00.000Z',
    bestBeforeAt: '2027-04-01T00:00:00.000Z',
    expiresAt: '2027-10-01T00:00:00.000Z',
    status: 'available',
    metadata: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  }
}

const ALL_COMMAND_IDS = [
  'wms.warehouses.create',
  'wms.warehouses.update',
  'wms.warehouses.delete',
  'wms.zones.create',
  'wms.zones.update',
  'wms.zones.delete',
  'wms.locations.create',
  'wms.locations.update',
  'wms.locations.delete',
  'wms.inventoryProfiles.create',
  'wms.inventoryProfiles.update',
  'wms.inventoryProfiles.delete',
  'wms.lots.create',
  'wms.lots.update',
  'wms.lots.delete',
] as const

describe('WMS configuration commands — undoable contract', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('every configuration command is registered as undoable (has undo handler, isUndoable !== false)', () => {
    for (const id of ALL_COMMAND_IDS) {
      const handler = commandRegistry.get(id)
      expect(handler).toBeTruthy()
      expect(handler!.isUndoable).not.toBe(false)
      expect(typeof handler!.undo).toBe('function')
    }
  })

  it('create commands carry only `after` snapshot in undo payload', async () => {
    const cases: Array<{ id: string; resultKey: string; result: any; after: any }> = [
      { id: 'wms.warehouses.create', resultKey: 'warehouseId', result: { warehouseId: 'wh-1' }, after: warehouseSnapshot() },
      { id: 'wms.zones.create', resultKey: 'zoneId', result: { zoneId: 'zone-1' }, after: zoneSnapshot() },
      { id: 'wms.locations.create', resultKey: 'locationId', result: { locationId: 'loc-1' }, after: locationSnapshot() },
      { id: 'wms.inventoryProfiles.create', resultKey: 'profileId', result: { profileId: 'profile-1' }, after: profileSnapshot() },
      { id: 'wms.lots.create', resultKey: 'lotId', result: { lotId: 'lot-1' }, after: lotSnapshot() },
    ]
    for (const { id, result, after } of cases) {
      const handler = commandRegistry.get(id)!
      const log = (await handler.buildLog?.({
        input: {},
        result,
        ctx: { auth: { tenantId: TENANT, orgId: ORG } } as any,
        snapshots: { after } as any,
      } as any)) as any
      expect(log).toBeTruthy()
      expect(log.snapshotAfter).toEqual(after)
      expect(log.payload?.undo).toMatchObject({ after })
      expect(log.payload?.undo?.before).toBeUndefined()
    }
  })

  it('update commands carry both `before` and `after` snapshots', async () => {
    const cases = [
      { id: 'wms.warehouses.update', resultKey: 'warehouseId', result: { warehouseId: 'wh-1' }, before: warehouseSnapshot(), after: { ...warehouseSnapshot(), name: 'Renamed DC' } },
      { id: 'wms.zones.update', resultKey: 'zoneId', result: { zoneId: 'zone-1' }, before: zoneSnapshot(), after: { ...zoneSnapshot(), priority: 9 } },
      { id: 'wms.locations.update', resultKey: 'locationId', result: { locationId: 'loc-1' }, before: locationSnapshot(), after: { ...locationSnapshot(), code: 'A1-B2' } },
      { id: 'wms.inventoryProfiles.update', resultKey: 'profileId', result: { profileId: 'profile-1' }, before: profileSnapshot(), after: { ...profileSnapshot(), defaultStrategy: 'lifo' } },
      { id: 'wms.lots.update', resultKey: 'lotId', result: { lotId: 'lot-1' }, before: lotSnapshot(), after: { ...lotSnapshot(), status: 'hold' } },
    ]
    for (const { id, result, before, after } of cases) {
      const handler = commandRegistry.get(id)!
      const log = (await handler.buildLog?.({
        input: {},
        result,
        ctx: { auth: { tenantId: TENANT, orgId: ORG } } as any,
        snapshots: { before, after } as any,
      } as any)) as any
      expect(log).toBeTruthy()
      expect(log.snapshotBefore).toEqual(before)
      expect(log.snapshotAfter).toEqual(after)
      expect(log.payload?.undo).toMatchObject({ before, after })
    }
  })

  it('delete commands carry only `before` snapshot in undo payload', async () => {
    const cases = [
      { id: 'wms.warehouses.delete', resultKey: 'warehouseId', result: { warehouseId: 'wh-1' }, before: warehouseSnapshot() },
      { id: 'wms.zones.delete', resultKey: 'zoneId', result: { zoneId: 'zone-1' }, before: zoneSnapshot() },
      { id: 'wms.locations.delete', resultKey: 'locationId', result: { locationId: 'loc-1' }, before: locationSnapshot() },
      { id: 'wms.inventoryProfiles.delete', resultKey: 'profileId', result: { profileId: 'profile-1' }, before: profileSnapshot() },
      { id: 'wms.lots.delete', resultKey: 'lotId', result: { lotId: 'lot-1' }, before: lotSnapshot() },
    ]
    for (const { id, result, before } of cases) {
      const handler = commandRegistry.get(id)!
      const log = (await handler.buildLog?.({
        input: {},
        result,
        ctx: { auth: { tenantId: TENANT, orgId: ORG } } as any,
        snapshots: { before } as any,
      } as any)) as any
      expect(log).toBeTruthy()
      expect(log.snapshotBefore).toEqual(before)
      expect(log.payload?.undo).toMatchObject({ before })
      expect(log.payload?.undo?.after).toBeUndefined()
    }
  })

  it('undo of create soft-deletes the existing record (warehouse)', async () => {
    const handler = commandRegistry.get('wms.warehouses.create')!
    const after = warehouseSnapshot()
    const record: any = { ...after, deletedAt: null }
    const flushed: Array<unknown> = []
    const ctx: any = {
      auth: { tenantId: TENANT, orgId: ORG },
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return {
              fork: () => ({
                findOne: jest.fn(async (_entity: unknown, filters: any) => (filters?.id === record.id ? record : null)),
                flush: jest.fn(async () => { flushed.push('flush') }),
              }),
            }
          }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    }
    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { after } } } as any,
      ctx,
      undoToken: 'token-1',
    } as any)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(flushed).toHaveLength(1)
  })

  it('undo of delete restores soft-deleted record from snapshot (warehouse)', async () => {
    const handler = commandRegistry.get('wms.warehouses.delete')!
    const before = warehouseSnapshot()
    const record: any = {
      id: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      name: 'STALE',
      code: 'STALE',
      deletedAt: new Date('2026-04-20T00:00:00.000Z'),
    }
    const flushed: Array<unknown> = []
    const ctx: any = {
      auth: { tenantId: TENANT, orgId: ORG },
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return {
              fork: () => ({
                findOne: jest.fn(async (_entity: unknown, filters: any) => (filters?.id === record.id ? record : null)),
                flush: jest.fn(async () => { flushed.push('flush') }),
                create: jest.fn(),
                persist: jest.fn(),
              }),
            }
          }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    }
    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before } } } as any,
      ctx,
      undoToken: 'token-2',
    } as any)
    expect(record.deletedAt).toBeNull()
    expect(record.name).toBe(before.name)
    expect(record.code).toBe(before.code)
    expect(flushed).toHaveLength(1)
  })

  it('undo of update restores `before` snapshot fields (warehouse)', async () => {
    const handler = commandRegistry.get('wms.warehouses.update')!
    const before = warehouseSnapshot()
    const record: any = {
      id: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      name: 'AFTER NAME',
      code: 'AFTER',
      isActive: false,
      addressLine1: 'after addr',
      city: 'after city',
      postalCode: 'after zip',
      country: 'XX',
      timezone: 'UTC',
      metadata: { changed: true },
      deletedAt: null,
    }
    const flushed: Array<unknown> = []
    const ctx: any = {
      auth: { tenantId: TENANT, orgId: ORG },
      container: {
        resolve: (name: string) => {
          if (name === 'em') {
            return {
              fork: () => ({
                findOne: jest.fn(async (_entity: unknown, filters: any) => (filters?.id === record.id ? record : null)),
                flush: jest.fn(async () => { flushed.push('flush') }),
                create: jest.fn(),
                persist: jest.fn(),
              }),
            }
          }
          throw new Error(`unexpected resolve: ${name}`)
        },
      },
    }
    await handler.undo!({
      input: {},
      logEntry: { commandPayload: { undo: { before, after: { ...before, name: 'AFTER NAME' } } } } as any,
      ctx,
      undoToken: 'token-3',
    } as any)
    expect(record.name).toBe(before.name)
    expect(record.code).toBe(before.code)
    expect(record.isActive).toBe(before.isActive)
    expect(record.addressLine1).toBe(before.addressLine1)
    expect(record.city).toBe(before.city)
    expect(record.country).toBe(before.country)
    expect(flushed).toHaveLength(1)
  })

  it('undo is a no-op when payload has neither before nor after', async () => {
    for (const id of ALL_COMMAND_IDS) {
      const handler = commandRegistry.get(id)!
      const ctx: any = {
        auth: { tenantId: TENANT, orgId: ORG },
        container: {
          resolve: () => {
            throw new Error('em should not be resolved when payload is empty')
          },
        },
      }
      await expect(handler.undo!({
        input: {},
        logEntry: { commandPayload: { undo: {} } } as any,
        ctx,
        undoToken: 'token-empty',
      } as any)).resolves.toBeUndefined()
    }
  })
})
