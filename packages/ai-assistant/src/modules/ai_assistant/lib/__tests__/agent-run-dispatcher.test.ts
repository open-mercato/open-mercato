import {
  AI_AGENT_RUN_DISPATCHER_DI_KEY,
  AiAgentDispatchDeniedError,
  isAiAgentDispatchDeniedError,
  resolveAiAgentRunDispatcher,
  type AiAgentRunDispatcher,
} from '../agent-run-dispatcher'

function makeDispatcher(): AiAgentRunDispatcher {
  return {
    owns: () => true,
    isAvailable: async () => true,
    runObject: async () => ({ result: { ok: true }, agentRunId: 'run-1' }),
  }
}

function makeContainer(registrations: Record<string, unknown>) {
  return {
    resolve<T>(name: string): T {
      if (!(name in registrations)) throw new Error(`[internal] ${name} not registered`)
      return registrations[name] as T
    },
  }
}

describe('resolveAiAgentRunDispatcher', () => {
  it('uses the canonical DI key', () => {
    expect(AI_AGENT_RUN_DISPATCHER_DI_KEY).toBe('aiAgentRunDispatcher')
  })

  it('returns null when no container is given', () => {
    expect(resolveAiAgentRunDispatcher(null)).toBeNull()
    expect(resolveAiAgentRunDispatcher(undefined)).toBeNull()
  })

  it('returns null when the dispatcher is not registered', () => {
    expect(resolveAiAgentRunDispatcher(makeContainer({}))).toBeNull()
  })

  it('returns null when resolving throws', () => {
    const container = {
      resolve<T>(): T {
        throw new Error('[internal] resolution failed')
      },
    }
    expect(resolveAiAgentRunDispatcher(container)).toBeNull()
  })

  it.each([
    ['undefined', undefined],
    ['a string', 'dispatcher'],
    ['an object missing runObject', { owns: () => true, isAvailable: async () => true }],
  ])('returns null for an invalid registered value (%s)', (_label, value) => {
    expect(resolveAiAgentRunDispatcher(makeContainer({ [AI_AGENT_RUN_DISPATCHER_DI_KEY]: value }))).toBeNull()
  })

  it('returns the registered dispatcher instance', () => {
    const dispatcher = makeDispatcher()
    const resolved = resolveAiAgentRunDispatcher(makeContainer({ [AI_AGENT_RUN_DISPATCHER_DI_KEY]: dispatcher }))
    expect(resolved).toBe(dispatcher)
  })
})

describe('AiAgentDispatchDeniedError', () => {
  it('carries the code and agent id with an internal message', () => {
    const error = new AiAgentDispatchDeniedError('agent_invoke_denied', 'sales.quote_agent')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AiAgentDispatchDeniedError')
    expect(error.code).toBe('agent_invoke_denied')
    expect(error.agentId).toBe('sales.quote_agent')
    expect(error.message.startsWith('[internal]')).toBe(true)
    expect(isAiAgentDispatchDeniedError(error)).toBe(true)
  })

  it('supports the missing-principal code and a custom message', () => {
    const error = new AiAgentDispatchDeniedError('agent_principal_missing', 'ops.triage', '[internal] no principal')
    expect(error.code).toBe('agent_principal_missing')
    expect(error.message).toBe('[internal] no principal')
    expect(isAiAgentDispatchDeniedError(new Error('other'))).toBe(false)
  })
})
