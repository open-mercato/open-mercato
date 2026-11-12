import { setup } from '../setup'

describe('workflows setup schedules', () => {
  it('registers metric rollup for an organization created later without seeding workflows', async () => {
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
      targetQueue: 'workflow-definition-metric-rollup',
    }))
  })
})
