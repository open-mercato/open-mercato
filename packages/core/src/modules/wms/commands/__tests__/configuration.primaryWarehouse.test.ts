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
const OTHER_TENANT = '55555555-5555-4555-8555-555555555555'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRIMARY_ID = '33333333-3333-4333-8333-333333333333'
const SECONDARY_ID = '44444444-4444-4444-8444-444444444444'

type WarehouseRecord = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  isActive: boolean
  isPrimary: boolean
  deletedAt: Date | null
  addressLine1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  timezone: string | null
  metadata: unknown
  createdAt: Date
  updatedAt: Date
}

function matchesWarehouseFilters(record: WarehouseRecord, filters: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(filters)) {
    if (key === 'deletedAt') {
      if (value === null && record.deletedAt !== null) return false
      continue
    }
    if (key === 'id' && value && typeof value === 'object' && '$ne' in (value as object)) {
      if (record.id === (value as { $ne: string }).$ne) return false
      continue
    }
    if ((record as Record<string, unknown>)[key] !== value) return false
  }
  return true
}

function createWarehouseStore(initial: WarehouseRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, { ...record }]))
  let nextId = initial.length + 1

  const em = {
    findOne: jest.fn(async (_entity: unknown, filters: Record<string, unknown>) => {
      for (const record of records.values()) {
        if (matchesWarehouseFilters(record, filters)) return record
      }
      return null
    }),
    find: jest.fn(async (_entity: unknown, filters: Record<string, unknown>) =>
      [...records.values()].filter((record) => matchesWarehouseFilters(record, filters)),
    ),
    nativeUpdate: jest.fn(async (_entity: unknown, filters: Record<string, unknown>, update: Record<string, unknown>) => {
      for (const record of records.values()) {
        if (matchesWarehouseFilters(record, filters)) {
          Object.assign(record, update)
        }
      }
    }),
    create: jest.fn((_entity: unknown, data: WarehouseRecord) => {
      const record = {
        ...data,
        id: data.id ?? `wh-${nextId++}`,
        createdAt: data.createdAt ?? new Date(),
        updatedAt: data.updatedAt ?? new Date(),
        deletedAt: data.deletedAt ?? null,
      }
      records.set(record.id, record)
      return record
    }),
    persist: jest.fn((record: WarehouseRecord) => {
      records.set(record.id, record)
      return em
    }),
    flush: jest.fn(async () => undefined),
  }

  return { em, records }
}

function createCtx(em: ReturnType<typeof createWarehouseStore>['em']) {
  return {
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') {
          return { fork: () => em }
        }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  }
}

describe('WMS warehouse primary enforcement', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('create with isPrimary demotes existing primary warehouses', async () => {
    const store = createWarehouseStore([
      {
        id: PRIMARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Primary DC',
        code: 'PRIMARY',
        isActive: true,
        isPrimary: true,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em)

    const result = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Secondary DC',
        code: 'SECONDARY',
        isPrimary: true,
      },
      ctx as never,
    )

    expect(result.demotedPrimariesBefore).toEqual([{ id: PRIMARY_ID, isPrimary: true }])
    expect(store.records.get(PRIMARY_ID)?.isPrimary).toBe(false)
    expect([...store.records.values()].filter((record) => record.isPrimary)).toHaveLength(1)
    expect(store.em.nativeUpdate).toHaveBeenCalled()
  })

  it('update with isPrimary demotes sibling primaries and keeps at most one primary', async () => {
    const store = createWarehouseStore([
      {
        id: PRIMARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Primary DC',
        code: 'PRIMARY',
        isActive: true,
        isPrimary: true,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
      {
        id: SECONDARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Secondary DC',
        code: 'SECONDARY',
        isActive: true,
        isPrimary: false,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.update')!
    const ctx = createCtx(store.em)

    const result = await handler.execute!(
      {
        id: SECONDARY_ID,
        isPrimary: true,
      },
      ctx as never,
    )

    expect(result.demotedPrimariesBefore).toEqual([{ id: PRIMARY_ID, isPrimary: true }])
    expect(store.records.get(PRIMARY_ID)?.isPrimary).toBe(false)
    expect(store.records.get(SECONDARY_ID)?.isPrimary).toBe(true)
    expect([...store.records.values()].filter((record) => record.isPrimary)).toHaveLength(1)
  })

  it('does not demote siblings when create/update does not set primary', async () => {
    const store = createWarehouseStore([
      {
        id: PRIMARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Primary DC',
        code: 'PRIMARY',
        isActive: true,
        isPrimary: true,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em)

    const result = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Regular DC',
        code: 'REGULAR',
        isPrimary: false,
      },
      ctx as never,
    )

    expect(result.demotedPrimariesBefore).toBeUndefined()
    expect(store.records.get(PRIMARY_ID)?.isPrimary).toBe(true)
    expect(store.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('create with isPrimary demotes primary warehouses across tenants in the same organization', async () => {
    const store = createWarehouseStore([
      {
        id: PRIMARY_ID,
        organizationId: ORG,
        tenantId: OTHER_TENANT,
        name: 'Cross-tenant Primary DC',
        code: 'CROSS-PRIMARY',
        isActive: true,
        isPrimary: true,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em)

    const result = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Tenant Primary DC',
        code: 'TENANT-PRIMARY',
        isPrimary: true,
      },
      ctx as never,
    )

    expect(result.demotedPrimariesBefore).toEqual([{ id: PRIMARY_ID, isPrimary: true }])
    expect(store.records.get(PRIMARY_ID)?.isPrimary).toBe(false)
    expect(store.em.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG, isPrimary: true }),
      { isPrimary: false },
    )
    expect(
      store.em.nativeUpdate.mock.calls.some((call) => Object.prototype.hasOwnProperty.call(call[1], 'tenantId')),
    ).toBe(false)
  })

  it('rejects create when isPrimary is true and isActive is false', async () => {
    const store = createWarehouseStore()
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em)

    await expect(
      handler.execute!(
        {
          tenantId: TENANT,
          organizationId: ORG,
          name: 'Inactive Primary DC',
          code: 'INACTIVE-PRIMARY',
          isPrimary: true,
          isActive: false,
        },
        ctx as never,
      ),
    ).rejects.toThrow(/Inactive warehouses cannot be marked as primary/i)
  })

  it('clears isPrimary when deactivating a primary warehouse', async () => {
    const store = createWarehouseStore([
      {
        id: PRIMARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Primary DC',
        code: 'PRIMARY',
        isActive: true,
        isPrimary: true,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.update')!
    const ctx = createCtx(store.em)

    await handler.execute!(
      {
        id: PRIMARY_ID,
        isActive: false,
      },
      ctx as never,
    )

    expect(store.records.get(PRIMARY_ID)?.isActive).toBe(false)
    expect(store.records.get(PRIMARY_ID)?.isPrimary).toBe(false)
  })

  it('rejects update when marking an inactive warehouse as primary', async () => {
    const store = createWarehouseStore([
      {
        id: SECONDARY_ID,
        organizationId: ORG,
        tenantId: TENANT,
        name: 'Inactive DC',
        code: 'INACTIVE',
        isActive: false,
        isPrimary: false,
        deletedAt: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        country: null,
        timezone: null,
        metadata: null,
        createdAt: new Date('2026-04-15T00:00:00.000Z'),
        updatedAt: new Date('2026-04-15T00:00:00.000Z'),
      },
    ])
    const handler = commandRegistry.get('wms.warehouses.update')!
    const ctx = createCtx(store.em)

    await expect(
      handler.execute!(
        {
          id: SECONDARY_ID,
          isPrimary: true,
        },
        ctx as never,
      ),
    ).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({
        fieldErrors: { isPrimary: expect.stringMatching(/inactive/i) },
      }),
    })
  })
})
