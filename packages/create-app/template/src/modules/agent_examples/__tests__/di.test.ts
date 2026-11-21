import { createContainer, InjectionMode } from 'awilix'
import { isProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { agentReferenceResolverDiKey } from '@open-mercato/shared/lib/ai/referenceResolver'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import { SUPPORT_POLICY_RESOLVER_ID, supportPolicyResolver } from '../lib/supportPolicies'

describe('agent_examples DI registrar', () => {
  it('is process-safe, so enabling the example module keeps OM_PROCESS_CONTAINER_ROOT active', () => {
    expect(isProcessDiRegistrar(register)).toBe(true)
  })

  it('registers the support policy reference resolver', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC }) as unknown as AppContainer
    register(container)
    expect(container.resolve(agentReferenceResolverDiKey(SUPPORT_POLICY_RESOLVER_ID))).toBe(supportPolicyResolver)
  })
})
