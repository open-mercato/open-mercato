import { setup } from '../setup'
import { AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE } from '../lib/queue'

describe('agent_orchestrator setup schedules', () => {
  it('registers metric rollup for an organization created later without replaying default seeds', async () => {
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
      targetQueue: AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE,
    }))
  })
})
