import { listEntityMetadata, listEntityMetadataFromRegistry } from '../entityMetadata'

const personMeta = { className: 'Person', tableName: 'people' }
const orderMeta = { className: 'Order', tableName: 'orders' }

describe('listEntityMetadataFromRegistry', () => {
  it('reads the MikroORM v7 Map returned by getAll()', () => {
    const registry = { getAll: () => new Map([[Object, personMeta], [Array, orderMeta]]) }
    expect(listEntityMetadataFromRegistry(registry)).toEqual([personMeta, orderMeta])
  })

  it('reads the MikroORM v6 dictionary returned by getAll()', () => {
    const registry = { getAll: () => ({ Person: personMeta, Order: orderMeta }) }
    expect(listEntityMetadataFromRegistry(registry)).toEqual([personMeta, orderMeta])
  })

  it('falls back to the metadata property when getAll() yields nothing', () => {
    const registry = { getAll: () => new Map(), metadata: { Person: personMeta } }
    expect(listEntityMetadataFromRegistry(registry)).toEqual([personMeta])
  })

  it('returns an empty array for a missing registry', () => {
    expect(listEntityMetadataFromRegistry(null)).toEqual([])
    expect(listEntityMetadataFromRegistry({})).toEqual([])
  })
})

describe('listEntityMetadata', () => {
  it('resolves the registry through getMetadata()', () => {
    const em = { getMetadata: () => ({ getAll: () => new Map([[Object, personMeta]]) }) }
    expect(listEntityMetadata(em)).toEqual([personMeta])
  })

  it('returns an empty array when the source exposes no registry', () => {
    expect(listEntityMetadata({})).toEqual([])
    expect(listEntityMetadata(undefined)).toEqual([])
  })
})
