import { asValue, createContainer, InjectionMode } from 'awilix'
import {
  AI_AGENT_RUN_DISPATCHER_DI_KEY,
  resolveAiAgentRunDispatcher,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-run-dispatcher'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

jest.mock('../lib/sdk/defineAgent', () => ({
  ...jest.requireActual('../lib/sdk/defineAgent'),
  ensureAgentsLoaded: jest.fn(async () => undefined),
}))

import { register } from '../di'

describe('agent_orchestrator DI registers the ai-assistant agent run dispatcher', () => {
  it('resolves the dispatcher through the port key in a request scope', () => {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ commandBus: asValue({}) })
    register(container as unknown as AppContainer)

    const scope = container.createScope()
    const dispatcher = resolveAiAgentRunDispatcher(scope)
    expect(dispatcher).not.toBeNull()
    expect(typeof dispatcher?.owns).toBe('function')
    expect(typeof dispatcher?.isAvailable).toBe('function')
    expect(typeof dispatcher?.runObject).toBe('function')
    expect(scope.resolve(AI_AGENT_RUN_DISPATCHER_DI_KEY)).toBe(scope.resolve(AI_AGENT_RUN_DISPATCHER_DI_KEY))
  })
})
