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
  it('runs durably for each organization-created event', () => {
    expect(metadata).toEqual({
      event: 'directory.organization.created',
      persistent: true,
      id: 'directory:seed-organization-defaults',
    })
  })

  it('runs every enabled onOrganizationCreated hook in an isolated organization scope', async () => {
    const firstHook = jest.fn(async () => {})
    const unsafeTenantSeed = jest.fn(async () => {})
    const secondHook = jest.fn(async () => {})
    registerModules([
      { id: 'first', setup: { onOrganizationCreated: firstHook } },
      { id: 'tenant-seed-only', setup: { seedDefaults: unsafeTenantSeed } },
      { id: 'without-seed' },
      { id: 'second', setup: { onOrganizationCreated: secondHook } },
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
    expect(firstHook).toHaveBeenCalledWith(expect.objectContaining({
      em: forks[0],
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    }))
    expect(secondHook).toHaveBeenCalledWith(expect.objectContaining({
      em: forks[1],
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    }))

    expect(unsafeTenantSeed).not.toHaveBeenCalled()

    const firstContainer = firstHook.mock.calls[0]?.[0].container
    expect(firstContainer.resolve('em')).toBe(forks[0])
    expect(firstContainer.hasRegistration('schedulerService')).toBe(true)
    expect(firstContainer.resolve('schedulerService')).toBe(schedulerService)
    expect(firstContainer.hasRegistration('missing')).toBe(false)
  })

  it('continues provisioning later modules after one hook fails', async () => {
    const failingHook = jest.fn(async () => {
      throw new Error('seed failed')
    })
    const succeedingHook = jest.fn(async () => {})
    registerModules([
      { id: 'failing', setup: { onOrganizationCreated: failingHook } },
      { id: 'succeeding', setup: { onOrganizationCreated: succeedingHook } },
    ] as Module[])
    const { em } = makeEntityManager()

    await expect(seedOrganizationDefaults({}, {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`unexpected registration: ${name}`)
      },
      tenantId: 'tenant-1',
      organizationId: 'organization-2',
    })).rejects.toThrow('One or more organization default hooks failed')

    expect(failingHook).toHaveBeenCalledTimes(1)
    expect(succeedingHook).toHaveBeenCalledTimes(1)
  })

  it('does nothing without trusted tenant and organization scope', async () => {
    const onOrganizationCreated = jest.fn(async () => {})
    registerModules([{ id: 'seeded', setup: { onOrganizationCreated } }] as Module[])
    const { em } = makeEntityManager()
    const resolve = jest.fn(() => em)

    await seedOrganizationDefaults(
      { tenantId: 'payload-tenant', organizationId: 'payload-organization' },
      { resolve },
    )

    expect(resolve).not.toHaveBeenCalled()
    expect(onOrganizationCreated).not.toHaveBeenCalled()
  })
})
