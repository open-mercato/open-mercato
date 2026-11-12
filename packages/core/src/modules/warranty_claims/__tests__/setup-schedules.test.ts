import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { seedWarrantyClaimDictionaries } from '../lib/dictionaries'
import { setup } from '../setup'

jest.mock('../lib/dictionaries', () => ({
  seedWarrantyClaimDictionaries: jest.fn(async () => undefined),
}))

type SeedDefaultsContext = Parameters<NonNullable<typeof setup.seedDefaults>>[0]

describe('warranty_claims seedDefaults', () => {
  let previousEntityIds: EntityIds
  const register = jest.fn(async () => undefined)
  const seedContext = {
    em: {},
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
    container: {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: (name: string) => {
        if (name === 'schedulerService') return { register }
        throw new Error(`[internal] unexpected registration: ${name}`)
      },
    },
  } as unknown as SeedDefaultsContext

  beforeEach(() => {
    jest.clearAllMocks()
    previousEntityIds = getEntityIds(false)
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds)
  })

  it('skips the claim dictionaries and still registers the SLA sweep when dictionaries is disabled', async () => {
    registerEntityIds({ warranty_claims: { warranty_claim: 'warranty_claims:warranty_claim' } })

    await setup.seedDefaults?.(seedContext)

    expect(seedWarrantyClaimDictionaries).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'organization-1',
      targetQueue: 'warranty_claims.sla_sweep',
    }))
  })

  it('seeds the claim dictionaries when dictionaries is enabled', async () => {
    registerEntityIds({ dictionaries: { dictionary: 'dictionaries:dictionary' } })

    await setup.seedDefaults?.(seedContext)

    expect(seedWarrantyClaimDictionaries).toHaveBeenCalledWith(seedContext.em, {
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })
    expect(register).toHaveBeenCalledTimes(1)
  })
})

describe('warranty_claims setup schedules', () => {
  it('registers the SLA sweep for an organization created later', async () => {
    const register = jest.fn(async () => undefined)
    const container = {
      hasRegistration: (name: string) => name === 'schedulerService',
      resolve: (name: string) => {
        if (name === 'schedulerService') return { register }
        throw new Error(`[internal] unexpected registration: ${name}`)
      },
    }

    await setup.onOrganizationCreated?.({
      container,
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    } as never)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'organization',
      organizationId: 'organization-2',
      targetQueue: 'warranty_claims.sla_sweep',
    }))
  })
})
