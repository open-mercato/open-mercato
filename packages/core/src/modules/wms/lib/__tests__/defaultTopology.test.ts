/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Site,
  SiteWarehouseRole,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../../data/entities'
import { seedWmsDefaultTopology } from '../defaultTopology'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const mockFindOneWithDecryption = jest.mocked(findOneWithDecryption)

const scope = {
  tenantId: 'tenant-1',
  organizationId: 'organization-1',
}

function buildEntityManager() {
  const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => data)
  const persist = jest.fn()
  const flush = jest.fn().mockResolvedValue(undefined)
  return {
    em: { create, persist, flush } as unknown as EntityManager,
    create,
    persist,
    flush,
  }
}

describe('seedWmsDefaultTopology', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('creates one default site, warehouse, and finished-goods assignment for an empty WMS topology', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em, create, persist, flush } = buildEntityManager()

    await expect(seedWmsDefaultTopology(em, scope)).resolves.toBe(true)

    expect(create).toHaveBeenNthCalledWith(1, Site, {
      ...scope,
      code: 'MAIN',
      name: 'Main Site',
      isActive: true,
    })
    expect(create).toHaveBeenNthCalledWith(2, Warehouse, {
      ...scope,
      code: 'MAIN',
      name: 'Main Warehouse',
      isActive: true,
      isPrimary: true,
    })
    expect(create).toHaveBeenNthCalledWith(
      3,
      SiteWarehouseRole,
      expect.objectContaining({
        ...scope,
        role: 'finished_goods',
        isDefault: true,
      }),
    )
    expect(persist).toHaveBeenCalledTimes(3)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it.each([
    [Site, 'site'],
    [Warehouse, 'warehouse'],
    [SiteWarehouseRole, 'role assignment'],
    [WarehouseZone, 'zone'],
    [WarehouseLocation, 'location'],
  ])('does not seed when the WMS topology already has a %s', async (entity, _label) => {
    mockFindOneWithDecryption.mockImplementation(async (_em, candidate) =>
      candidate === entity ? ({ id: 'existing' } as never) : null,
    )
    const { em, create, persist, flush } = buildEntityManager()

    await expect(seedWmsDefaultTopology(em, scope)).resolves.toBe(false)

    expect(create).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('treats a unique-constraint race as an idempotent no-op', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const { em, flush } = buildEntityManager()
    flush.mockRejectedValue({ code: '23505' })

    await expect(seedWmsDefaultTopology(em, scope)).resolves.toBe(false)
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
