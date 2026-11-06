import { stepCountIs } from 'ai'
import type { AiAgentDefinition } from '../ai-agent-definition'
import { canonicalJsonStringify, computeAgentDefinitionHash } from '../agent-definition-hash'
import {
  applyAgentExtensionEntriesForTests,
  applyAgentOverrideEntriesForTests,
  getAgentDefinitionHash,
  resetAgentRegistryForTests,
  seedAgentRegistryForTests,
} from '../agent-registry'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const HASH_FORMAT = /^sha256:[0-9a-f]{64}$/

function makeAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
  return {
    id: 'example.hash_agent',
    moduleId: 'example',
    label: 'Hash agent',
    description: 'Agent used by hash tests',
    systemPrompt: 'You are a test agent.',
    allowedTools: ['search.hybrid_search', 'meta.describe_agent'],
    executionMode: 'chat',
    mutationPolicy: 'read-only',
    defaultModel: 'gpt-5-mini',
    modelSettings: { temperature: 0.2, maxOutputTokens: 512 },
    loop: { maxSteps: 4, budget: { maxToolCalls: 6 } },
    ...overrides,
  }
}

describe('computeAgentDefinitionHash', () => {
  it('produces a prefixed sha256 hash that is stable for the same definition', () => {
    const first = computeAgentDefinitionHash(makeAgent())
    const second = computeAgentDefinitionHash(makeAgent())
    expect(first).toMatch(HASH_FORMAT)
    expect(second).toBe(first)
  })

  it('is independent of property key order', () => {
    const agent = makeAgent()
    const reordered: AiAgentDefinition = {
      loop: { budget: { maxToolCalls: 6 }, maxSteps: 4 },
      modelSettings: { maxOutputTokens: 512, temperature: 0.2 },
      defaultModel: agent.defaultModel,
      mutationPolicy: agent.mutationPolicy,
      executionMode: agent.executionMode,
      allowedTools: agent.allowedTools,
      systemPrompt: agent.systemPrompt,
      description: agent.description,
      label: agent.label,
      moduleId: agent.moduleId,
      id: agent.id,
    }
    expect(computeAgentDefinitionHash(reordered)).toBe(computeAgentDefinitionHash(agent))
  })

  it('is independent of allowedTools order', () => {
    const forward = computeAgentDefinitionHash(makeAgent())
    const reversed = computeAgentDefinitionHash(
      makeAgent({ allowedTools: ['meta.describe_agent', 'search.hybrid_search'] }),
    )
    expect(reversed).toBe(forward)
  })

  it('changes when the system prompt changes', () => {
    const base = computeAgentDefinitionHash(makeAgent())
    const changed = computeAgentDefinitionHash(makeAgent({ systemPrompt: 'You are a different agent.' }))
    expect(changed).toMatch(HASH_FORMAT)
    expect(changed).not.toBe(base)
  })

  it('changes when modelSettings change', () => {
    const base = computeAgentDefinitionHash(makeAgent())
    const changed = computeAgentDefinitionHash(
      makeAgent({ modelSettings: { temperature: 0.7, maxOutputTokens: 512 } }),
    )
    expect(changed).not.toBe(base)
  })

  it('ignores labels and descriptions that do not affect behavior', () => {
    const base = computeAgentDefinitionHash(makeAgent())
    const relabeled = computeAgentDefinitionHash(makeAgent({ label: 'Renamed', description: 'Other copy' }))
    expect(relabeled).toBe(base)
  })

  it('ignores function-valued loop fields without throwing', () => {
    const base = computeAgentDefinitionHash(makeAgent())
    const withFunctions = makeAgent({
      loop: {
        maxSteps: 4,
        budget: { maxToolCalls: 6 },
        prepareStep: async () => undefined,
        onStepFinish: async () => undefined,
        repairToolCall: async () => null,
      },
    })
    expect(() => computeAgentDefinitionHash(withFunctions)).not.toThrow()
    expect(computeAgentDefinitionHash(withFunctions)).toBe(base)
  })

  it('represents stop conditions by their declared kinds', () => {
    const declarative = computeAgentDefinitionHash(
      makeAgent({ loop: { maxSteps: 4, stopWhen: [{ kind: 'hasToolCall', toolName: 'meta.finish' }] } }),
    )
    const otherTool = computeAgentDefinitionHash(
      makeAgent({ loop: { maxSteps: 4, stopWhen: [{ kind: 'hasToolCall', toolName: 'meta.other' }] } }),
    )
    const customFirst = computeAgentDefinitionHash(
      makeAgent({ loop: { maxSteps: 4, stopWhen: { kind: 'custom', stop: stepCountIs(2) } } }),
    )
    const customSecond = computeAgentDefinitionHash(
      makeAgent({ loop: { maxSteps: 4, stopWhen: { kind: 'custom', stop: stepCountIs(5) } } }),
    )
    expect(declarative).not.toBe(otherTool)
    expect(customFirst).toBe(customSecond)
    expect(customFirst).not.toBe(declarative)
  })
})

describe('canonicalJsonStringify', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJsonStringify({ beta: [3, 1], alpha: { delta: true, gamma: 'value' } })).toBe(
      '{"alpha":{"delta":true,"gamma":"value"},"beta":[3,1]}',
    )
  })

  it('drops functions, undefined values and circular references', () => {
    const circular: Record<string, unknown> = { name: 'node' }
    circular.self = circular
    expect(canonicalJsonStringify({ handler: () => 1, missing: undefined, circular })).toBe(
      '{"circular":{"name":"node"}}',
    )
  })
})

describe('agent registry definition hashes', () => {
  afterEach(() => {
    resetAgentRegistryForTests()
  })

  it('computes a hash for every registered agent at load', () => {
    const agent = makeAgent()
    seedAgentRegistryForTests([agent])
    expect(getAgentDefinitionHash(agent.id)).toBe(computeAgentDefinitionHash(agent))
    expect(getAgentDefinitionHash('example.unknown_agent')).toBeUndefined()
  })

  it('recomputes the hash when an override replaces the agent', () => {
    const agent = makeAgent()
    seedAgentRegistryForTests([agent])
    const before = getAgentDefinitionHash(agent.id)
    applyAgentOverrideEntriesForTests([
      {
        moduleId: 'other_module',
        overrides: { [agent.id]: makeAgent({ systemPrompt: 'Replaced prompt.' }) },
      },
    ])
    const after = getAgentDefinitionHash(agent.id)
    expect(after).toMatch(HASH_FORMAT)
    expect(after).not.toBe(before)
  })

  it('drops the hash when an override disables the agent', () => {
    const agent = makeAgent()
    seedAgentRegistryForTests([agent])
    applyAgentOverrideEntriesForTests([{ moduleId: 'other_module', overrides: { [agent.id]: null } }])
    expect(getAgentDefinitionHash(agent.id)).toBeUndefined()
  })

  it('recomputes the hash when an extension patches the agent', () => {
    const agent = makeAgent()
    seedAgentRegistryForTests([agent])
    const before = getAgentDefinitionHash(agent.id)
    applyAgentExtensionEntriesForTests([
      { targetAgentId: agent.id, appendSystemPrompt: 'Also answer briefly.' },
    ])
    expect(getAgentDefinitionHash(agent.id)).not.toBe(before)
  })
})
