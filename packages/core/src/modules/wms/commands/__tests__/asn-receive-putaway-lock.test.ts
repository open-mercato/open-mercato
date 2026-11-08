/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  Asn,
  InventoryBalance,
  PutawayTask,
  ReceivingLine,
  Warehouse,
  WarehouseLocation,
} from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ASN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const WH_ID = '55555555-5555-4555-8555-555555555555'
const LOC_ID = '66666666-6666-4666-8666-666666666666'
const VARIANT_ID = '77777777-7777-4777-8777-777777777777'
const USER_ID = '99999999-9999-4999-8999-999999999999'
const CANCELLED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type OpenTask = { id: string; quantity: string; sourceLocationId: string }
type Trx = { __releases: Array<() => void> }

describe('cancelled-receipt putaway recreate shares the source balance lock', () => {
  beforeAll(async () => {
    await import('../asn')
    await import('../putaway')
  })

  it('never lets a retry and a manual create commit more than the available quantity', async () => {
    const openTasks: OpenTask[] = []
    const balanceLocks: Array<LockMode | null> = []
    let held = false
    let waiting = 0
    let maxWaiters = 0
    const queue: Array<() => void> = []

    const release = () => {
      const next = queue.shift()
      if (next) next()
      else held = false
    }
    const acquire = (trx: Trx) => {
      if (!held) {
        held = true
        trx.__releases.push(release)
        return Promise.resolve()
      }
      waiting += 1
      maxWaiters = Math.max(maxWaiters, waiting)
      return new Promise<void>((resolve) => {
        queue.push(() => {
          waiting -= 1
          held = true
          trx.__releases.push(release)
          resolve()
        })
      })
    }

    const em = {
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => {
        const task: OpenTask = {
          id: `task-${openTasks.length + 1}`,
          quantity: String(payload.quantity),
          sourceLocationId: String(payload.sourceLocationId),
        }
        openTasks.push(task)
        return { id: task.id, ...payload }
      }),
      persist: jest.fn(() => ({ flush: jest.fn(async () => undefined) })),
      flush: jest.fn(async () => undefined),
      getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
      fork: jest.fn(),
      transactional: jest.fn(),
      getConnection: jest.fn(() => ({
        execute: jest.fn(async () => [{ id: CANCELLED_ID }]),
      })),
    }
    em.fork.mockReturnValue(em)
    em.transactional.mockImplementation(async (cb: (trx: typeof em & Trx) => Promise<unknown>) => {
      const trx = Object.create(em) as typeof em & Trx
      trx.__releases = []
      try {
        return await cb(trx)
      } finally {
        for (const unlock of trx.__releases) unlock()
      }
    })

    findOneWithDecryption.mockImplementation(async (trx: Trx, entity: unknown, where: Record<string, unknown>, options?: { lockMode?: LockMode }) => {
      if (entity === Asn) {
        return {
          id: ASN_ID,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WH_ID },
          status: 'in_transit',
          referenceNumber: null,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          deletedAt: null,
        }
      }
      if (entity === ReceivingLine) {
        return {
          id: LINE_ID,
          tenantId: TENANT,
          organizationId: ORG,
          asn: ASN_ID,
          catalogVariantId: VARIANT_ID,
          receivedQty: '10',
          expectedQty: '10',
          qcStatus: 'passed',
          serialNumbers: null,
          lotNumber: null,
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
          deletedAt: null,
        }
      }
      if (entity === Warehouse) {
        return { id: WH_ID, tenantId: TENANT, organizationId: ORG }
      }
      if (entity === WarehouseLocation) {
        return {
          id: where.id,
          tenantId: TENANT,
          organizationId: ORG,
          warehouse: { id: WH_ID },
          type: 'staging',
          isActive: true,
        }
      }
      if (entity === PutawayTask) {
        if (where.id === CANCELLED_ID) {
          return { id: CANCELLED_ID, quantity: '10', lotId: null, status: 'cancelled' }
        }
        return null
      }
      if (entity === InventoryBalance) {
        balanceLocks.push(options?.lockMode ?? null)
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) await acquire(trx)
        return {
          tenantId: TENANT,
          organizationId: ORG,
          quantityOnHand: '10',
          quantityReserved: '0',
          quantityAllocated: '0',
        }
      }
      return null
    })
    findWithDecryption.mockImplementation(async (_trx, entity: unknown) => {
      if (entity !== PutawayTask) return []
      const snapshot = openTasks.map((task) => ({ ...task }))
      await new Promise((resolve) => setTimeout(resolve, 100))
      return snapshot
    })

    const ctx = {
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'dataEngine') return {}
          throw new Error(`Unexpected resolve: ${name}`)
        },
      },
      auth: { sub: USER_ID, tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    }

    const receive = commandRegistry.get('wms.asns.receive-line')!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        asnId: ASN_ID,
        lineId: LINE_ID,
        receivedQty: 10,
        targetReceivedQty: 10,
        targetStagingLocationId: LOC_ID,
        qcStatus: 'passed',
        performedBy: USER_ID,
      },
      ctx as never,
    )
    const manual = commandRegistry.get('wms.putaway-tasks.create')!.execute(
      {
        organizationId: ORG,
        tenantId: TENANT,
        warehouseId: WH_ID,
        sourceLocationId: LOC_ID,
        catalogVariantId: VARIANT_ID,
        quantity: 10,
      },
      ctx as never,
    )

    await Promise.allSettled([receive, manual])

    const committed = openTasks.reduce((sum, task) => sum + Number(task.quantity), 0)
    expect(committed).toBeGreaterThan(0)
    expect(committed).toBeLessThanOrEqual(10)
    expect(maxWaiters).toBeGreaterThanOrEqual(1)
    expect(balanceLocks.length).toBeGreaterThanOrEqual(2)
    expect(balanceLocks.every((mode) => mode === LockMode.PESSIMISTIC_WRITE)).toBe(true)
  })
})
