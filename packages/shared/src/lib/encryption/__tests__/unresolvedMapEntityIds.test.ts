const mockWarn = jest.fn()

jest.mock('../../logger', () => ({
  createLogger: () => ({ child: () => ({ warn: mockWarn }) }),
}))

import { registerEntityIds } from '../entityIds'
import {
  findUnresolvedEncryptionMapEntityIds,
  resetUnresolvedEncryptionMapWarnings,
  warnUnresolvedEncryptionMapEntityIds,
} from '../unresolvedMapEntityIds'

const entityIds = {
  customers: {
    customer_entity: 'customers:customer_entity',
    customer_deal: 'customers:customer_deal',
  },
  fleet: {
    vehicle_profile: 'fleet:vehicle_profile',
    vehicle_trip: 'fleet:vehicle_trip',
  },
}

describe('findUnresolvedEncryptionMapEntityIds', () => {
  it('accepts maps whose entityId is a registered entity', () => {
    expect(
      findUnresolvedEncryptionMapEntityIds(
        [{ entityId: 'customers:customer_entity' }, { entityId: 'fleet:vehicle_trip' }],
        entityIds,
      ),
    ).toEqual([])
  })

  it('reports a map that names no entity of a module that registers entities, with the closest match', () => {
    expect(
      findUnresolvedEncryptionMapEntityIds([{ entityId: 'fleet:vehicle' }, { entityId: 'fleet:vehicle' }], entityIds),
    ).toEqual([{ entityId: 'fleet:vehicle', suggestion: 'fleet:vehicle_trip' }])
    expect(findUnresolvedEncryptionMapEntityIds([{ entityId: 'fleet:vehicle_profiles' }], entityIds)).toEqual([
      { entityId: 'fleet:vehicle_profiles', suggestion: 'fleet:vehicle_profile' },
    ])
  })

  it('prefers an entity that shares the declared prefix over a merely shorter edit', () => {
    const registry = {
      customers: {
        customer_deal: 'customers:customer_deal',
        customer_person_profile: 'customers:customer_person_profile',
      },
    }

    expect(findUnresolvedEncryptionMapEntityIds([{ entityId: 'customers:customer_person' }], registry)).toEqual([
      { entityId: 'customers:customer_person', suggestion: 'customers:customer_person_profile' },
    ])
  })

  it('leaves ids outside an entity-registering module alone', () => {
    expect(
      findUnresolvedEncryptionMapEntityIds(
        [{ entityId: 'vector:vector_search' }, { entityId: 'no_colon_id' }],
        entityIds,
      ),
    ).toEqual([])
  })
})

describe('warnUnresolvedEncryptionMapEntityIds', () => {
  beforeEach(() => {
    mockWarn.mockClear()
    resetUnresolvedEncryptionMapWarnings()
    registerEntityIds(entityIds)
  })

  it('warns once per unresolved map, however often bootstrap runs', () => {
    const maps = [{ entityId: 'fleet:vehicle_profiles' }, { entityId: 'customers:customer_entity' }]

    warnUnresolvedEncryptionMapEntityIds(maps)
    warnUnresolvedEncryptionMapEntityIds(maps)

    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('stored as plaintext'), {
      entityId: 'fleet:vehicle_profiles',
      suggestion: 'fleet:vehicle_profile',
    })
  })

  it('stays quiet when every map resolves', () => {
    warnUnresolvedEncryptionMapEntityIds([{ entityId: 'customers:customer_deal' }])

    expect(mockWarn).not.toHaveBeenCalled()
  })
})
