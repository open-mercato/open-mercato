import { mergeCommandCorrelationContext, resolveCommandCorrelationId } from '../correlation'
import type { CommandRuntimeContext } from '../types'

function createContext(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: {} as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
    ...overrides,
  }
}

describe('command correlation', () => {
  it('prefers an explicit runtime correlation id', () => {
    const ctx = createContext({
      correlationId: 'agent-run-1',
      request: new Request('https://example.test', { headers: { 'x-request-id': 'request-1' } }),
    })

    expect(resolveCommandCorrelationId(ctx)).toBe('agent-run-1')
    expect(mergeCommandCorrelationContext({ source: 'agent' }, ctx)).toEqual({
      source: 'agent',
      correlationId: 'agent-run-1',
    })
  })

  it('uses the request id and preserves an existing context correlation id', () => {
    const ctx = createContext({
      request: new Request('https://example.test', { headers: { 'x-request-id': 'request-1' } }),
    })

    expect(resolveCommandCorrelationId(ctx)).toBe('request-1')
    expect(mergeCommandCorrelationContext({ correlationId: 'existing' }, ctx)).toEqual({
      correlationId: 'existing',
    })
  })
})
