/**
 * Phase 0 unit tests for the agentic loop control surface.
 *
 * Covers:
 * - resolveEffectiveLoopConfig — precedence chain (caller > agent.loop > legacyMaxSteps > wrapper default)
 * - translateStopConditions — mapping of AiAgentLoopStopCondition to SDK helpers + hard stepCountIs fallback
 * - mergeStepOverrides — security-critical tool-allowlist enforcement
 * - assertLoopObjectModeCompatible — object-mode field rejection
 *
 * Phase 0 of spec 2026-04-28-ai-agents-agentic-loop-controls.
 */

const stepCountIsMock = jest.fn((count: number) => ({ __kind: 'stepCount', count }))
const hasToolCallMock = jest.fn((name: string) => ({ __kind: 'hasToolCall', name }))

jest.mock('ai', () => {
  const actual = jest.requireActual('ai')
  return {
    ...actual,
    stepCountIs: (count: number) => stepCountIsMock(count),
    hasToolCall: (name: string) => hasToolCallMock(name),
  }
})

import type { AiAgentDefinition } from '../ai-agent-definition'
import type { PrepareStepResult, ToolSet } from 'ai'
import {
  resolveEffectiveLoopConfig,
  translateStopConditions,
  mergeStepOverrides,
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
// resolveEffectiveLoopConfig
// ---------------------------------------------------------------------------

describe('resolveEffectiveLoopConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns wrapper default when agent has no loop config and no caller override', () => {
    const agent = makeAgent({ id: 'mod.agent', moduleId: 'mod' })
    const result = resolveEffectiveLoopConfig(agent, undefined, { maxSteps: 10 })
    expect(result.maxSteps).toBe(10)
  })

  it('uses legacy agent.maxSteps when agent.loop is absent', () => {
    const agent = makeAgent({ id: 'mod.agent', moduleId: 'mod', maxSteps: 5 })
    const result = resolveEffectiveLoopConfig(agent, undefined, { maxSteps: 10 })
    expect(result.maxSteps).toBe(5)
  })

  it('agent.loop wins over legacy maxSteps when both are present', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      maxSteps: 5,
      loop: { maxSteps: 8 },
    })
    const result = resolveEffectiveLoopConfig(agent, undefined, { maxSteps: 10 })
    expect(result.maxSteps).toBe(8)
  })

  it('caller loop override wins over agent.loop', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { maxSteps: 8 },
    })
    const result = resolveEffectiveLoopConfig(agent, { maxSteps: 3 }, { maxSteps: 10 })
    expect(result.maxSteps).toBe(3)
  })

  it('caller loop preserves agent-level stopWhen when caller does not override it', () => {
    const agentStop = { kind: 'hasToolCall' as const, toolName: 'mod.tool' }
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { stopWhen: agentStop },
    })
    const result = resolveEffectiveLoopConfig(agent, { maxSteps: 3 }, { maxSteps: 10 })
    expect(result.stopWhen).toEqual(agentStop)
    expect(result.maxSteps).toBe(3)
  })

  it('caller override replaces agent stopWhen when caller sets stopWhen', () => {
    const agentStop = { kind: 'hasToolCall' as const, toolName: 'mod.tool' }
    const callerStop = { kind: 'stepCount' as const, count: 2 }
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { stopWhen: agentStop },
    })
    const result = resolveEffectiveLoopConfig(agent, { stopWhen: callerStop }, { maxSteps: 10 })
    expect(result.stopWhen).toEqual(callerStop)
  })

  it('legacy maxSteps is NOT applied when agent.loop is present (loop wins)', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      maxSteps: 99,
      loop: { maxSteps: 7 },
    })
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(7)
  })

  it('returns wrapper default maxSteps when no source provides maxSteps', () => {
    const agent = makeAgent({ id: 'mod.agent', moduleId: 'mod' })
    const result = resolveEffectiveLoopConfig(agent, undefined, { maxSteps: 10 })
    expect(result.maxSteps).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// translateStopConditions
// ---------------------------------------------------------------------------

describe('translateStopConditions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('always includes stepCountIs(maxSteps) as the final element', () => {
    const result = translateStopConditions({ maxSteps: 5 })
    expect(stepCountIsMock).toHaveBeenCalledWith(5)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ __kind: 'stepCount', count: 5 })
  })

  it('defaults to maxSteps=10 when maxSteps is not set', () => {
    translateStopConditions({})
    expect(stepCountIsMock).toHaveBeenCalledWith(10)
  })

  it('maps kind:stepCount to stepCountIs', () => {
    const result = translateStopConditions({
      maxSteps: 10,
      stopWhen: { kind: 'stepCount', count: 3 },
    })
    expect(stepCountIsMock).toHaveBeenCalledWith(3)
    expect(result).toHaveLength(2)
  })

  it('maps kind:hasToolCall to hasToolCall', () => {
    const result = translateStopConditions({
      maxSteps: 10,
      stopWhen: { kind: 'hasToolCall', toolName: 'mod.update' },
    })
    expect(hasToolCallMock).toHaveBeenCalledWith('mod.update')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ __kind: 'hasToolCall', name: 'mod.update' })
    expect(result[1]).toEqual({ __kind: 'stepCount', count: 10 })
  })

  it('passes kind:custom predicates through as-is', () => {
    const customStop = jest.fn(() => false) as unknown as import('ai').StopCondition<Record<string, unknown>>
    const result = translateStopConditions({
      maxSteps: 10,
      stopWhen: { kind: 'custom', stop: customStop },
    })
    expect(result[0]).toBe(customStop)
    expect(result).toHaveLength(2)
  })

  it('handles an array of stopWhen conditions', () => {
    const result = translateStopConditions({
      maxSteps: 4,
      stopWhen: [
        { kind: 'hasToolCall', toolName: 'mod.a' },
        { kind: 'hasToolCall', toolName: 'mod.b' },
      ],
    })
    expect(hasToolCallMock).toHaveBeenCalledWith('mod.a')
    expect(hasToolCallMock).toHaveBeenCalledWith('mod.b')
    expect(result).toHaveLength(3)
    expect(result[2]).toEqual({ __kind: 'stepCount', count: 4 })
  })
})

// ---------------------------------------------------------------------------
// mergeStepOverrides
// ---------------------------------------------------------------------------

describe('mergeStepOverrides', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const agent = makeAgent({
    id: 'mod.agent',
    moduleId: 'mod',
    allowedTools: ['mod.read', 'mod.write'],
  })

  const wrappedRead = { execute: jest.fn(), description: 'read tool' }
  const wrappedWrite = { execute: jest.fn(), description: 'write tool', isMutation: true }
  const wrappedRegistry = {
    mod__read: wrappedRead,
    mod__write: wrappedWrite,
  }

  it('returns wrapperOverride unchanged when userOverride is null', () => {
    const wrapper: PrepareStepResult<ToolSet> = { activeTools: ['mod__read'] }
    expect(mergeStepOverrides(wrapper, null, agent, wrappedRegistry)).toBe(wrapper)
  })

  it('returns wrapperOverride unchanged when userOverride is undefined', () => {
    const wrapper: PrepareStepResult<ToolSet> = { activeTools: ['mod__read'] }
    expect(mergeStepOverrides(wrapper, undefined, agent, wrappedRegistry)).toBe(wrapper)
  })

  it('merges model from userOverride', () => {
    const fakeModel = { id: 'gpt-5-mini' } as unknown as import('ai').LanguageModel
    const result = mergeStepOverrides({}, { model: fakeModel }, agent, wrappedRegistry)
    expect(result.model).toBe(fakeModel)
  })

  it('merges toolChoice from userOverride', () => {
    const result = mergeStepOverrides({}, { toolChoice: 'none' }, agent, wrappedRegistry)
    expect(result.toolChoice).toBe('none')
  })

  it('filters user activeTools to only those in agent.allowedTools (dotted names)', () => {
    const result = mergeStepOverrides(
      {},
      { activeTools: ['mod.read', 'mod.write', 'outside.tool'] },
      agent,
      wrappedRegistry,
    )
    expect(result.activeTools).toEqual(['mod.read', 'mod.write'])
  })

  it('replaces user tools with wrapped counterparts from wrappedRegistry', () => {
    const rawHandler = { execute: jest.fn() }
    const result = mergeStepOverrides(
      {},
      { tools: { mod__read: rawHandler } as unknown as PrepareStepResult<ToolSet>['tools'] },
      agent,
      wrappedRegistry,
    )
    expect((result.tools as Record<string, unknown>)['mod__read']).toBe(wrappedRead)
  })

  it('drops user tools not present in wrappedRegistry with a warning', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const rawHandler = { execute: jest.fn() }
    const result = mergeStepOverrides(
      {},
      { tools: { unknown__tool: rawHandler } as unknown as PrepareStepResult<ToolSet>['tools'] },
      agent,
      wrappedRegistry,
    )
    expect((result.tools as Record<string, unknown>)['unknown__tool']).toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('unknown__tool'),
    )
    consoleSpy.mockRestore()
  })

  it('throws loop_violates_mutation_policy when user returns raw mutation handler', () => {
    const { toolRegistry: registry } = jest.requireActual('../tool-registry') as {
      toolRegistry: { getTool: (name: string) => unknown }
    }
    jest.spyOn(registry, 'getTool').mockImplementation((name: string) => {
      if (name === 'mod.write') return { isMutation: true }
      return undefined
    })

    const rawMutationHandler = { execute: jest.fn() }
    expect(() =>
      mergeStepOverrides(
        {},
        { tools: { mod__write: rawMutationHandler } as unknown as PrepareStepResult<ToolSet>['tools'] },
        agent,
        wrappedRegistry,
      ),
    ).toThrow(AgentPolicyError)

    jest.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// assertLoopObjectModeCompatible
// ---------------------------------------------------------------------------

describe('assertLoopObjectModeCompatible', () => {
  it('does not throw for object-safe loop fields', () => {
    expect(() =>
      assertLoopObjectModeCompatible({
        maxSteps: 5,
        budget: { maxTokens: 50000 },
        onStepFinish: jest.fn(),
        onStepStart: jest.fn(),
        allowRuntimeOverride: true,
      }),
    ).not.toThrow()
  })

  it('throws loop_unsupported_in_object_mode for prepareStep', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ prepareStep: jest.fn() }),
    ).toThrow(AgentPolicyError)
    try {
      assertLoopObjectModeCompatible({ prepareStep: jest.fn() })
    } catch (error) {
      expect(error).toBeInstanceOf(AgentPolicyError)
      expect((error as AgentPolicyError).code).toBe('loop_unsupported_in_object_mode')
    }
  })

  it('throws for repairToolCall', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ repairToolCall: jest.fn() }),
    ).toThrow(AgentPolicyError)
  })

  it('throws for stopWhen', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ stopWhen: { kind: 'stepCount', count: 3 } }),
    ).toThrow(AgentPolicyError)
  })

  it('throws for activeTools', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ activeTools: ['mod.read'] }),
    ).toThrow(AgentPolicyError)
  })

  it('throws for toolChoice', () => {
    expect(() =>
      assertLoopObjectModeCompatible({ toolChoice: 'none' }),
    ).toThrow(AgentPolicyError)
  })

  it('mentions all unsupported fields in the error message', () => {
    try {
      assertLoopObjectModeCompatible({ prepareStep: jest.fn(), stopWhen: { kind: 'stepCount', count: 2 } })
    } catch (error) {
      expect((error as Error).message).toContain('prepareStep')
      expect((error as Error).message).toContain('stopWhen')
    }
  })
})

// ---------------------------------------------------------------------------
// ai-agent-definition legacy maxSteps and loop field acceptance
// ---------------------------------------------------------------------------

describe('defineAiAgent loop field acceptance (Phase 0 BC)', () => {
  it('legacy maxSteps is still accepted on AiAgentDefinition', () => {
    const agent = makeAgent({ id: 'mod.agent', moduleId: 'mod', maxSteps: 5 })
    expect(agent.maxSteps).toBe(5)
  })

  it('loop field is accepted on AiAgentDefinition', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      loop: { maxSteps: 7, stopWhen: { kind: 'hasToolCall', toolName: 'mod.update' } },
    })
    expect(agent.loop?.maxSteps).toBe(7)
    const stopWhen = agent.loop?.stopWhen
    expect(stopWhen).toEqual({ kind: 'hasToolCall', toolName: 'mod.update' })
  })

  it('loop and maxSteps can coexist (loop wins in resolveEffectiveLoopConfig)', () => {
    const agent = makeAgent({
      id: 'mod.agent',
      moduleId: 'mod',
      maxSteps: 99,
      loop: { maxSteps: 4 },
    })
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(4)
  })
})
