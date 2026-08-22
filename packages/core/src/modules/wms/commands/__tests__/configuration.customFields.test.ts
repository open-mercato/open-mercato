/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { E } from '#generated/entities.ids.generated'

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
const CREATED_ID = '66666666-6666-4666-8666-666666666666'

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

function createWarehouseStore(initial: WarehouseRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, { ...record }]))

  const em = {
    findOne: jest.fn(async (_entity: unknown, filters: Record<string, unknown>) => {
      for (const record of records.values()) {
        if (filters.id && record.id !== filters.id) continue
        if (filters.deletedAt === null && record.deletedAt !== null) continue
        return record
      }
      return null
    }),
    find: jest.fn(async () => [...records.values()]),
    nativeUpdate: jest.fn(),
    create: jest.fn((_entity: unknown, data: WarehouseRecord) => {
      const record = {
        ...data,
        id: data.id ?? CREATED_ID,
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
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  }

  return { em, records }
}

function createCtx(
  em: ReturnType<typeof createWarehouseStore>['em'],
  dataEngine?: { setCustomFields: jest.Mock },
) {
  return {
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') {
          return { fork: () => em }
        }
        if (name === 'dataEngine' && dataEngine) {
          return dataEngine
        }
        throw new Error(`unexpected resolve: ${name}`)
      },
    },
  }
}

describe('WMS warehouse custom fields', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../configuration')
  })

  it('does not resolve dataEngine when creating a warehouse without custom fields', async () => {
    const store = createWarehouseStore()
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em)

    const result = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Plain DC',
        code: 'PLAIN',
      },
      ctx as never,
    )

    expect(result.warehouseId).toBeTruthy()
    expect(typeof result.updatedAt).toBe('string')
    expect(result.updatedAt).toBeTruthy()
  })

  it('persists custom fields on warehouse create and update', async () => {
    const store = createWarehouseStore()
    const setCustomFields = jest.fn().mockResolvedValue(undefined)
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em, { setCustomFields })

    const created = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'CF DC',
        code: 'CFDC',
        city: 'Gdynia',
        country: 'PL',
        timezone: 'Europe/Warsaw',
        cf_dock_code: 'DOCK-A',
      },
      ctx as never,
    )

    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: E.wms.warehouse,
      recordId: created.warehouseId,
      tenantId: TENANT,
      organizationId: ORG,
      values: expect.objectContaining({ dock_code: 'DOCK-A' }),
    }))

    setCustomFields.mockClear()
    const updateHandler = commandRegistry.get('wms.warehouses.update')!
    await updateHandler.execute!(
      {
        id: created.warehouseId,
        tenantId: TENANT,
        organizationId: ORG,
        cf_dock_code: 'DOCK-B',
      },
      ctx as never,
    )

    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: E.wms.warehouse,
      recordId: created.warehouseId,
      values: expect.objectContaining({ dock_code: 'DOCK-B' }),
    }))
  })

  it('clears custom fields when undoing warehouse create', async () => {
    const store = createWarehouseStore()
    const setCustomFields = jest.fn().mockResolvedValue(undefined)
    const handler = commandRegistry.get('wms.warehouses.create')!
    const ctx = createCtx(store.em, { setCustomFields })

    const created = await handler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Undo CF DC',
        code: 'UNDOCF',
        cf_dock_code: 'DOCK-A',
      },
      ctx as never,
    )
    const record = store.records.get(created.warehouseId)!
    setCustomFields.mockClear()

    await handler.undo!({
      input: {},
      logEntry: {
        commandPayload: {
          undo: {
            after: {
              id: record.id,
              organizationId: record.organizationId,
              tenantId: record.tenantId,
              name: record.name,
              code: record.code,
              isActive: record.isActive,
              isPrimary: record.isPrimary,
              addressLine1: record.addressLine1,
              city: record.city,
              postalCode: record.postalCode,
              country: record.country,
              timezone: record.timezone,
              metadata: record.metadata,
              createdAt: record.createdAt.toISOString(),
              updatedAt: record.updatedAt.toISOString(),
              custom: { dock_code: 'DOCK-A' },
            },
          },
        },
      },
      ctx,
      undoToken: 'undo-create-cf',
    } as never)

    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: E.wms.warehouse,
      recordId: created.warehouseId,
      values: expect.objectContaining({ dock_code: null }),
    }))
  })

  it('restores previous custom fields when undoing warehouse update', async () => {
    const store = createWarehouseStore()
    const setCustomFields = jest.fn().mockResolvedValue(undefined)
    const createHandler = commandRegistry.get('wms.warehouses.create')!
    const updateHandler = commandRegistry.get('wms.warehouses.update')!
    const ctx = createCtx(store.em, { setCustomFields })

    const created = await createHandler.execute!(
      {
        tenantId: TENANT,
        organizationId: ORG,
        name: 'Undo Update CF DC',
        code: 'UNDOUPD',
        cf_dock_code: 'DOCK-A',
      },
      ctx as never,
    )
    await updateHandler.execute!(
      {
        id: created.warehouseId,
        tenantId: TENANT,
        organizationId: ORG,
        cf_dock_code: 'DOCK-B',
      },
      ctx as never,
    )
    const record = store.records.get(created.warehouseId)!
    const snapshot = {
      id: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      name: record.name,
      code: record.code,
      isActive: record.isActive,
      isPrimary: record.isPrimary,
      addressLine1: record.addressLine1,
      city: record.city,
      postalCode: record.postalCode,
      country: record.country,
      timezone: record.timezone,
      metadata: record.metadata,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
    setCustomFields.mockClear()

    await updateHandler.undo!({
      input: {},
      logEntry: {
        commandPayload: {
          undo: {
            before: { ...snapshot, custom: { dock_code: 'DOCK-A' } },
            after: { ...snapshot, custom: { dock_code: 'DOCK-B' } },
          },
        },
      },
      ctx,
      undoToken: 'undo-update-cf',
    } as never)

    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({
      entityId: E.wms.warehouse,
      recordId: created.warehouseId,
      values: expect.objectContaining({ dock_code: 'DOCK-A' }),
    }))
  })
})
