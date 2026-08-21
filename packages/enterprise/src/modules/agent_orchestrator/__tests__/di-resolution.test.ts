import { asValue, createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import type { AgentModelUsageService } from '../lib/compliance/modelUsageService'

describe('agent orchestrator DI resolution', () => {
  it('injects the entity manager into the model usage service in classic mode', async () => {
    const scopedEm = {
      findOne: jest.fn().mockResolvedValue({ id: 'existing-usage' }),
    }
    const em = {
      fork: jest.fn(() => scopedEm),
    }
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ em: asValue(em) })
    register(container as unknown as AppContainer)

    const service = container.resolve<AgentModelUsageService>('agentModelUsageService')
    await service.record({
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
      agentRunId: 'run-1',
      agentId: 'agent-1',
      runtime: 'native',
      providerId: 'provider-1',
      modelId: 'model-1',
    })

    expect(em.fork).toHaveBeenCalledTimes(1)
    expect(scopedEm.findOne).toHaveBeenCalledTimes(1)
  })
})
