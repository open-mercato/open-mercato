/**
 * Step 5.16 — Phase 3 WS-D integration tests for the execution-budget
 * (`maxSteps`) contract on `runAiAgentText` and `runAiAgentObject`.
 *
 * Pins the Step 3.4 / 3.5 `stopWhen: stepCountIs(agent.maxSteps)` plumbing:
 *
 *   - agent declares `maxSteps: n (n > 0)` → `stopWhen: stepCountIs(n)`
 *   - agent omits `maxSteps` (or sets 0) → no `stopWhen` on the SDK args
 *   - `runAiAgentObject` preserves the exact same precedence — object-mode
 *     must not silently diverge from chat-mode (spec §1.5).
 *
 * The Step description also enumerates a "caller-passed stopWhen overrides
 * the agent's maxSteps" scenario. The current `RunAiAgentTextInput` /
 * `RunAiAgentObjectInput` shapes do NOT expose a per-call override surface
 * (only `modelOverride`). Introducing a public `maxStepsOverride` field
 * would require production code changes, and Step 5.16 is strictly
 * additive-test-only ("No new production code in this Step"). That
 * scenario is therefore documented as a deliberate gap in step-5.16-checks.md
 * rather than forced through a test-only seam that would misrepresent the
 * public contract.
 *
 * The AI SDK module is stubbed at the Jest module boundary. `streamText`,
 * `generateObject`, `streamObject`, `convertToModelMessages`, and
 * `stepCountIs` are all replaced by jest.fn()s so the test never hits a
 * real provider. The provider registry is stubbed the same way as in
 * `agent-runtime.test.ts`.
 */

const streamTextMock = jest.fn()
const generateObjectMock = jest.fn()
const streamObjectMock = jest.fn()
const convertToModelMessagesMock = jest.fn((messages: unknown) => messages)
const stepCountIsMock = jest.fn(
  (count: number) => ({ __stopWhen: 'stepCount', count }) as const,
)

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    streamText: (...args: unknown[]) => streamTextMock(...args),
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    streamObject: (...args: unknown[]) => streamObjectMock(...args),
    stepCountIs: (...args: unknown[]) => stepCountIsMock(...(args as [number])),
    convertToModelMessages: (...args: unknown[]) => convertToModelMessagesMock(...args),
  }
})

const createModelMock = jest.fn((options: { modelId: string; apiKey: string }) => ({
  id: options.modelId,
  apiKey: options.apiKey,
}))
const resolveApiKeyMock = jest.fn(() => 'test-api-key')

jest.mock('@open-mercato/shared/lib/ai/llm-provider-registry', () => ({
  llmProviderRegistry: {
    resolveFirstConfigured: () => ({
      id: 'test-provider',
      defaultModel: 'provider-default-model',
      resolveApiKey: resolveApiKeyMock,
      createModel: createModelMock,
    }),
  },
}))

import { z } from 'zod'
import type { AiAgentDefinition } from '../ai-agent-definition'
import {
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'
import { toolRegistry } from '../tool-registry'
import { runAiAgentObject, runAiAgentText } from '../agent-runtime'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt base.',
    allowedTools: [],
    ...overrides,
  }
}

const baseAuth = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
  features: ['*'],
  isSuperAdmin: true,
}

const baseMessages = [
  { role: 'user' as const, id: 'm1', parts: [{ type: 'text' as const, text: 'hi' }] },
]

function fakeStreamResult(): { toTextStreamResponse: jest.Mock } {
  return {
    toTextStreamResponse: jest.fn(
      () =>
        new Response('streamed', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    ),
  }
}

describe('Step 5.16 — runAiAgentText maxSteps budget (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    streamTextMock.mockImplementation(() => fakeStreamResult())
  })
  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('passes stopWhen: stepCountIs(agent.maxSteps) when maxSteps is a positive integer', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.account_assistant',
        moduleId: 'customers',
        maxSteps: 3,
      }),
    ])
    await runAiAgentText({
      agentId: 'customers.account_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })
    expect(stepCountIsMock).toHaveBeenCalledWith(3)
    const callArg = streamTextMock.mock.calls[0][0] as { stopWhen: unknown }
    expect(callArg.stopWhen).toEqual({ __stopWhen: 'stepCount', count: 3 })
  })

  it('omits stopWhen from the SDK args when maxSteps is undefined (SDK default)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.account_assistant',
        moduleId: 'customers',
        // Explicit undefined — the default case for most agents.
      }),
    ])
    await runAiAgentText({
      agentId: 'customers.account_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })
    expect(stepCountIsMock).not.toHaveBeenCalled()
    const callArg = streamTextMock.mock.calls[0][0] as {
      stopWhen?: unknown
    }
    expect('stopWhen' in callArg).toBe(false)
  })

  it('omits stopWhen when maxSteps is 0 (guard against accidental zero budget)', async () => {
    // Spec §1.4: maxSteps must be a positive integer; 0 is treated the same
    // as undefined so the SDK's own default controls the run instead of
    // short-circuiting to zero steps.
    seedAgentRegistryForTests([
      makeAgent({
        id: 'customers.account_assistant',
        moduleId: 'customers',
        maxSteps: 0,
      }),
    ])
    await runAiAgentText({
      agentId: 'customers.account_assistant',
      messages: baseMessages as never,
      authContext: baseAuth,
    })
    expect(stepCountIsMock).not.toHaveBeenCalled()
    const callArg = streamTextMock.mock.calls[0][0] as { stopWhen?: unknown }
    expect('stopWhen' in callArg).toBe(false)
  })
})

describe('Step 5.16 — runAiAgentObject maxSteps budget parity (integration)', () => {
  const schema = z.object({ summary: z.string() })

  beforeEach(() => {
    jest.clearAllMocks()
    resetAgentRegistryForTests()
    toolRegistry.clear()
    generateObjectMock.mockImplementation(async () => ({
      object: { summary: 'stub' },
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    }))
  })
  afterAll(() => {
    resetAgentRegistryForTests()
    toolRegistry.clear()
  })

  it('preserves agent.maxSteps → stopWhen on generateObject (object-mode parity)', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandising_assistant',
        moduleId: 'catalog',
        executionMode: 'object',
        output: {
          schemaName: 'MerchandisingProposal',
          schema,
          mode: 'generate',
        } as never,
        maxSteps: 4,
      }),
    ])
    await runAiAgentObject({
      agentId: 'catalog.merchandising_assistant',
      input: 'draft title variants',
      authContext: baseAuth,
    })
    expect(stepCountIsMock).toHaveBeenCalledWith(4)
    // runAiAgentObject augments the generateObject args dynamically — the
    // typed SDK surface ignores stopWhen but we MUST still forward it so
    // providers that honor it behave identically across chat / object.
    const callArg = generateObjectMock.mock.calls[0][0] as { stopWhen?: unknown }
    expect(callArg.stopWhen).toEqual({ __stopWhen: 'stepCount', count: 4 })
  })

  it('omits stopWhen on generateObject when the agent declares no maxSteps', async () => {
    seedAgentRegistryForTests([
      makeAgent({
        id: 'catalog.merchandising_assistant',
        moduleId: 'catalog',
        executionMode: 'object',
        output: {
          schemaName: 'MerchandisingProposal',
          schema,
          mode: 'generate',
        } as never,
      }),
    ])
    await runAiAgentObject({
      agentId: 'catalog.merchandising_assistant',
      input: 'draft title variants',
      authContext: baseAuth,
    })
    expect(stepCountIsMock).not.toHaveBeenCalled()
    const callArg = generateObjectMock.mock.calls[0][0] as { stopWhen?: unknown }
    expect('stopWhen' in callArg).toBe(false)
  })
})
