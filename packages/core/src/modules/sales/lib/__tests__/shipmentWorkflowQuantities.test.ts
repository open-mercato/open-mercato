import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadShippedQuantityByLine } from '../shipments/snapshots'
import { SalesShipment, SalesShipmentItem } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))

const find = jest.mocked(findWithDecryption)
const scope = { tenantId: 'tenant-one', organizationId: 'organization-one' }
const manager = {} as EntityManager
const shipments = [
  { id: 'pending', status: 'pending' },
  { id: 'cancelled', status: 'canceled' },
  { id: 'shipped', status: 'shipped' },
  { id: 'delivered', status: 'delivered' },
]

beforeEach(() => {
  find.mockReset()
  find.mockImplementation(async (_manager, entity, query) => {
    if (entity === SalesShipment) return shipments as never
    if (entity === SalesShipmentItem) {
      const ids = (query as { shipment: { $in: string[] } }).shipment.$in
      return ids.map((id) => ({ shipment: id, orderLine: 'line-one', quantity: '2' })) as never
    }
    return []
  })
})

it('counts only eligible shipment states and keeps both reads scoped', async () => {
  const result = await loadShippedQuantityByLine(manager, 'order-one', scope, ['shipped', 'delivered'])
  expect(result.get('line-one')).toBe(4)
  expect(find).toHaveBeenNthCalledWith(1, manager, SalesShipment, { order: 'order-one', deletedAt: null }, {}, scope)
  expect(find).toHaveBeenNthCalledWith(2, manager, SalesShipmentItem, { shipment: { $in: ['shipped', 'delivered'] } }, {}, scope)
})

it('preserves existing quantity aggregation when no policy is supplied', async () => {
  const result = await loadShippedQuantityByLine(manager, 'order-one', scope)
  expect(result.get('line-one')).toBe(8)
})

it('does not query item quantities when no shipment is eligible', async () => {
  const result = await loadShippedQuantityByLine(manager, 'order-one', scope, [])
  expect(result.size).toBe(0)
  expect(find).toHaveBeenCalledTimes(1)
})
