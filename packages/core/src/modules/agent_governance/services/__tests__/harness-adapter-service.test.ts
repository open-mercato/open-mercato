import { afterEach, describe, expect, jest, test } from '@jest/globals'
import {
  type HarnessAdapter,
  createClaudeAgentSdkHarnessAdapter,
  createHarnessAdapterService,
  createOpenCodeHarnessAdapter,
} from '../harness-adapter-service'
import { HarnessCapabilityError } from '../../lib/domain-errors'

function createJsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

describe('harness-adapter-service', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    delete process.env.AGENT_GOVERNANCE_HARNESS_PROVIDER
    delete process.env.AGENT_GOVERNANCE_ENABLE_CLAUDE_ADAPTER
    delete process.env.OPENCODE_URL
    delete process.env.OPENCODE_PASSWORD
  })

  test('registers providers and resolves active provider with fallback', () => {
    process.env.AGENT_GOVERNANCE_HARNESS_PROVIDER = 'unknown-provider'
    const service = createHarnessAdapterService()

    expect(service.getActiveProviderId()).toBe('opencode')
    expect(service.listProviders()).toEqual(['claude_agent_sdk', 'opencode'])
  })

  test('opencode adapter session + invoke path works', async () => {
    process.env.OPENCODE_URL = 'http://localhost:4096'

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(createJsonResponse(200, { id: 'session-1' }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          parts: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        }),
      )

    const adapter = createOpenCodeHarnessAdapter()
    const result = await adapter.invoke({ prompt: 'test prompt' })

    expect(result.provider).toBe('opencode')
    expect(result.sessionId).toBe('session-1')
    expect(result.text).toBe('hello\nworld')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  test('disabled claude adapter throws typed capability error', async () => {
    const adapter = createClaudeAgentSdkHarnessAdapter()

    await expect(adapter.invoke({ prompt: 'test' })).rejects.toBeInstanceOf(HarnessCapabilityError)
    await expect(adapter.invoke({ prompt: 'test' })).rejects.toMatchObject({ code: 'HARNESS_PROVIDER_DISABLED' })
  })

  test('service rejects unknown provider', async () => {
    const service = createHarnessAdapterService()

    await expect(service.invoke({ providerId: 'missing', prompt: 'ping' })).rejects.toMatchObject({
      code: 'HARNESS_PROVIDER_NOT_REGISTERED',
    })
  })

  test('falls back to opencode when active provider fails and no explicit provider override is set', async () => {
    process.env.AGENT_GOVERNANCE_ENABLE_CLAUDE_ADAPTER = 'true'
    const service = createHarnessAdapterService({ provider: 'claude_agent_sdk' })

    const fallbackInvoke = jest.fn().mockResolvedValue({
      provider: 'opencode',
      sessionId: 'fallback-session',
      text: 'fallback response',
      raw: { ok: true },
    })

    const fallbackAdapter: HarnessAdapter = {
      id: 'opencode',
      invoke: fallbackInvoke,
      stream: async () => ({
        provider: 'opencode',
        sessionId: 'fallback-stream-session',
        text: 'stream fallback',
        raw: { ok: true },
      }),
      session: async () => ({ provider: 'opencode', sessionId: 'fallback-session' }),
    }

    service.registerAdapter(fallbackAdapter)

    const result = await service.invoke({ prompt: 'hello' })
    expect(result.provider).toBe('opencode')
    expect(result.text).toBe('fallback response')
    expect(fallbackInvoke).toHaveBeenCalledTimes(1)
  })

  test('does not fall back when provider is explicitly requested', async () => {
    process.env.AGENT_GOVERNANCE_ENABLE_CLAUDE_ADAPTER = 'true'
    const service = createHarnessAdapterService({ provider: 'opencode' })

    await expect(service.invoke({ providerId: 'claude_agent_sdk', prompt: 'hello' })).rejects.toMatchObject({
      code: 'HARNESS_CAPABILITY_UNAVAILABLE',
    })
  })
})
