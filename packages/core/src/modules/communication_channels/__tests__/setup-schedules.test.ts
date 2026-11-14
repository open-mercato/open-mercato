import { setup } from '../setup'

describe('communication_channels setup schedules', () => {
  it('registers both organization schedules for an organization created later', async () => {
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

    expect(register).toHaveBeenCalledTimes(2)
    expect(register.mock.calls.map(([registration]) => registration)).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId: 'organization-2', targetQueue: 'communication-channels-poll-tick' }),
      expect.objectContaining({ organizationId: 'organization-2', targetQueue: 'communication-channels-gmail-renew-watch' }),
    ]))
  })
})
