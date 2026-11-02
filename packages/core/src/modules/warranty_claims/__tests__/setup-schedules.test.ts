import { setup } from '../setup'

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
