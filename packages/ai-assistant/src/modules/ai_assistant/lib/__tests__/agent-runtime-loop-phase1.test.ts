/**
 * Phase 1 unit tests for per-call loop overrides on runAiAgentText /
 * runAiAgentObject.
 *
 * Covers:
 * - Caller override is accepted when allowRuntimeOverride is true (default).
 * - AgentPolicyError loop_runtime_override_disabled when agent opts out.
 * - Object-mode loop subset: chat-only fields throw loop_unsupported_in_object_mode.
 * - resolveEffectiveLoopConfig caller precedence with gating.
 *
 * Phase 1 of spec 2026-04-28-ai-agents-agentic-loop-controls.
 */

const stepCountIsMock = jest.fn((count: number) => ({ __kind: 'stepCount', count }))

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    stepCountIs: (count: number) => stepCountIsMock(count),
  }
})

import type { AiAgentDefinition, AiAgentLoopConfig } from '../ai-agent-definition'
import {
  resolveEffectiveLoopConfig,
  assertLoopObjectModeCompatible,
} from '../agent-runtime'
import { AgentPolicyError } from '../agent-tools'

function makeAgent(
  overrides: Partial<AiAgentDefinition> & Pick<AiAgentDefinition, 'id' | 'moduleId'>,
): AiAgentDefinition {
  return {
    label: `${overrides.id} label`,
    description: `${overrides.id} description`,
    systemPrompt: 'System prompt.',
    allowedTools: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Per-call loop override gating
// ---------------------------------------------------------------------------

describe('Phase 1: caller loop override gating (loop_runtime_override_disabled)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('accepts per-call loop override when agent has no allowRuntimeOverride set (default true)', () => {
    const agent = makeAgent({ id: 'mod.agent', moduleId: 'mod' })
    expect(() =>
      resolveEffectiveLoopConfig(agent, { maxSteps: 3 }),
    ).not.toThrow()
  })

  it('accepts per-call loop override when agent explicitly sets allowRuntimeOverride: true', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { allowRuntimeOverride: true, maxSteps: 8 },
    })
    expect(() =>
      resolveEffectiveLoopConfig(agent, { maxSteps: 3 }),
    ).not.toThrow()
    const result = resolveEffectiveLoopConfig(agent, { maxSteps: 3 })
    expect(result.maxSteps).toBe(3)
  })

  it('throws loop_runtime_override_disabled when agent sets allowRuntimeOverride: false', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { allowRuntimeOverride: false, maxSteps: 8 },
    })
    expect(() =>
      resolveEffectiveLoopConfig(agent, { maxSteps: 3 }),
    ).toThrow(AgentPolicyError)

    try {
      resolveEffectiveLoopConfig(agent, { maxSteps: 3 })
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_runtime_override_disabled')
      expect((error as AgentPolicyError).message).toContain('mod.agent')
    }
  })

  it('does NOT throw when allowRuntimeOverride: false but no caller loop is supplied', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { allowRuntimeOverride: false, maxSteps: 8 },
    })
    expect(() =>
      resolveEffectiveLoopConfig(agent, undefined),
    ).not.toThrow()
    const result = resolveEffectiveLoopConfig(agent, undefined)
    expect(result.maxSteps).toBe(8)
  })

  it('caller loop fields override agent loop fields selectively', () => {
    const agentStop = { kind: 'hasToolCall' as const, toolName: 'mod.update' }
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { maxSteps: 8, stopWhen: agentStop },
    })
    const result = resolveEffectiveLoopConfig(agent, { maxSteps: 3 })
    expect(result.maxSteps).toBe(3)
    expect(result.stopWhen).toEqual(agentStop)
  })
})

// ---------------------------------------------------------------------------
// Object-mode loop subset
// ---------------------------------------------------------------------------

describe('Phase 1: object-mode loop subset enforcement', () => {
  it('accepts maxSteps in object mode', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ maxSteps: 3 }),
    ).not.toThrow()
  })

  it('accepts budget in object mode', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ budget: { maxTokens: 50000 } }),
    ).not.toThrow()
  })

  it('accepts onStepFinish in object mode', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ onStepFinish: jest.fn() }),
    ).not.toThrow()
  })

  it('accepts onStepStart in object mode', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ onStepStart: jest.fn() }),
    ).not.toThrow()
  })

  it('accepts allowRuntimeOverride in object mode', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ allowRuntimeOverride: true }),
    ).not.toThrow()
  })

  it('rejects prepareStep with loop_unsupported_in_object_mode', () => {
    try {
      assertLoopObjectModeCompatible({ prepareStep: jest.fn() })
      fail('Expected AgentPolicyError')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('rejects stopWhen with loop_unsupported_in_object_mode', () => {
    try {
      assertLoopObjectModeCompatible({ stopWhen: { kind: 'stepCount', count: 2 } })
      fail('Expected AgentPolicyError')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('rejects repairToolCall with loop_unsupported_in_object_mode', () => {
    try {
      assertLoopObjectModeCompatible({ repairToolCall: jest.fn() })
      fail('Expected AgentPolicyError')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('rejects activeTools with loop_unsupported_in_object_mode', () => {
    try {
      assertLoopObjectModeCompatible({ activeTools: ['mod.read'] })
      fail('Expected AgentPolicyError')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('rejects toolChoice with loop_unsupported_in_object_mode', () => {
    try {
      assertLoopObjectModeCompatible({ toolChoice: 'auto' })
      fail('Expected AgentPolicyError')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('lists all unsupported fields in the error message when multiple are set', () => {
    try {
      assertLoopObjectModeCompatible({
        prepareStep: jest.fn(),
        stopWhen: { kind: 'stepCount', count: 1 },
        activeTools: ['mod.read'],
      })
      fail('Expected AgentPolicyError')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('prepareStep')
      expect(message).toContain('stopWhen')
      expect(message).toContain('activeTools')
    }
  })
})

// ---------------------------------------------------------------------------
// AgentPolicyDenyCode exhaustiveness check
// ---------------------------------------------------------------------------

describe('Phase 1: AgentPolicyDenyCode has loop override codes', () => {
  it('AgentPolicyError can be constructed with loop_runtime_override_disabled', () => {
    const error = new AgentPolicyError('loop_runtime_override_disabled', 'test')
    expect(error.code).toBe('loop_runtime_override_disabled')
  })

  it('AgentPolicyError can be constructed with loop_unsupported_in_object_mode', () => {
    const error = new AgentPolicyError('loop_unsupported_in_object_mode', 'test')
    expect(error.code).toBe('loop_unsupported_in_object_mode')
  })

  it('AgentPolicyError can be constructed with loop_violates_mutation_policy', () => {
    const error = new AgentPolicyError('loop_violates_mutation_policy', 'test')
    expect(error.code).toBe('loop_violates_mutation_policy')
  })

  it('AgentPolicyError can be constructed with loop_active_tools_outside_allowlist', () => {
    const error = new AgentPolicyError('loop_active_tools_outside_allowlist', 'test')
    expect(error.code).toBe('loop_active_tools_outside_allowlist')
  })
})
