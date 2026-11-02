import seedOrganizationDefaults, {
  metadata,
} from '@open-mercato/core/modules/directory/subscribers/seedOrganizationDefaults'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'

function makeEntityManager() {
  const forks: Array<{ marker: string }> = []
  return {
    forks,
    em: {
      fork: jest.fn(() => {
        const fork = { marker: `fork-${forks.length + 1}` }
        forks.push(fork)
        return fork
      }),
    },
  }
}

describe('directory seedOrganizationDefaults subscriber', () => {
  it('runs inline for each organization-created event', () => {
    expect(metadata).toEqual({
      event: 'directory.organization.created',
      persistent: false,
      id: 'directory:seed-organization-defaults',
    })
  })

  it('runs every enabled seedDefaults hook in an isolated organization scope', async () => {
    const firstSeed = jest.fn(async () => {})
    const secondSeed = jest.fn(async () => {})
    registerModules([
      { id: 'first', setup: { seedDefaults: firstSeed } },
      { id: 'without-seed' },
      { id: 'second', setup: { seedDefaults: secondSeed } },
    ] as Module[])
    const { em, forks } = makeEntityManager()
    const schedulerService = { register: jest.fn(async () => {}) }
    const resolve = jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'schedulerService') return schedulerService
      throw new Error(`unexpected registration: ${name}`)
    })

    await seedOrganizationDefaults({}, {
      resolve,
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    })

    expect(em.fork).toHaveBeenCalledTimes(2)
    expect(firstSeed).toHaveBeenCalledWith(expect.objectContaining({
      em: forks[0],
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    }))
    expect(secondSeed).toHaveBeenCalledWith(expect.objectContaining({
      em: forks[1],
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    }))

    const firstContainer = firstSeed.mock.calls[0]?.[0].container
    expect(firstContainer.resolve('em')).toBe(forks[0])
    expect(firstContainer.hasRegistration('schedulerService')).toBe(true)
    expect(firstContainer.resolve('schedulerService')).toBe(schedulerService)
    expect(firstContainer.hasRegistration('missing')).toBe(false)
  })

  it('continues provisioning later modules after one hook fails', async () => {
    const failingSeed = jest.fn(async () => {
      throw new Error('seed failed')
    })
    const succeedingSeed = jest.fn(async () => {})
    registerModules([
      { id: 'failing', setup: { seedDefaults: failingSeed } },
      { id: 'succeeding', setup: { seedDefaults: succeedingSeed } },
    ] as Module[])
    const { em } = makeEntityManager()

    await expect(seedOrganizationDefaults({}, {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`unexpected registration: ${name}`)
      },
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    })).resolves.toBeUndefined()

    expect(failingSeed).toHaveBeenCalledTimes(1)
    expect(succeedingSeed).toHaveBeenCalledTimes(1)
  })

  it('does nothing without trusted tenant and organization scope', async () => {
    const seedDefaults = jest.fn(async () => {})
    registerModules([{ id: 'seeded', setup: { seedDefaults } }] as Module[])
    const { em } = makeEntityManager()
    const resolve = jest.fn(() => em)

    await seedOrganizationDefaults(
      { tenantId: 'payload-tenant', organizationId: 'payload-organization' },
      { resolve },
    )

    expect(resolve).not.toHaveBeenCalled()
    expect(seedDefaults).not.toHaveBeenCalled()
  })
})
