import { setup } from '../setup'

function makeContext(organizationId: string) {
  const register = jest.fn(async () => undefined)
  const unregister = jest.fn(async () => undefined)
  const container = {
    hasRegistration: (name: string) => name === 'schedulerService',
    resolve: (name: string) => {
      if (name === 'schedulerService') return { register, unregister }
      throw new Error(`[internal] unexpected registration: ${name}`)
    },
  }
  return {
    register,
    unregister,
    context: { container, tenantId: 'tenant-1', organizationId } as never,
  }
}

describe('integrations setup schedules', () => {
  it('registers a distinct health-probe schedule for every organization', async () => {
    const first = makeContext('organization-1')
    const second = makeContext('organization-2')

    await setup.onOrganizationCreated?.(first.context)
    await setup.onOrganizationCreated?.(second.context)

    const firstRegistration = first.register.mock.calls[0]?.[0]
    const secondRegistration = second.register.mock.calls[0]?.[0]
    expect(firstRegistration.id).not.toBe(secondRegistration.id)
    expect(firstRegistration).toMatchObject({
      scopeType: 'organization',
      organizationId: 'organization-1',
      tenantId: 'tenant-1',
      targetPayload: { scope: { organizationId: 'organization-1', tenantId: 'tenant-1' } },
    })
    expect(secondRegistration).toMatchObject({ organizationId: 'organization-2' })
  })

  it('migrates the legacy tenant-wide schedule before registering the organization schedule', async () => {
    const context = makeContext('organization-1')

    await setup.seedDefaults?.(context.context)

    expect(context.unregister).toHaveBeenCalledTimes(1)
    expect(context.unregister.mock.calls[0]?.[0]).not.toBe(context.register.mock.calls[0]?.[0].id)
    expect(context.unregister.mock.invocationCallOrder[0]).toBeLessThan(context.register.mock.invocationCallOrder[0])
  })
})
