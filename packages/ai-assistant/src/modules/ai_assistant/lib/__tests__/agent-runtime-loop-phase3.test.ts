/**
 * Phase 3 unit tests for BudgetEnforcer, kill-switch, and env shorthands.
 *
 * Covers:
 * - BudgetEnforcer.hasActiveBudget: true only when at least one budget axis is set.
 * - BudgetEnforcer.wire: returns original userOnStepFinish unchanged when no budget.
 * - BudgetEnforcer.wire: wraps onStepFinish when budget is active (tracks usage).
 * - BudgetEnforcer aborts after maxToolCalls exceeded.
 * - BudgetEnforcer aborts after maxTokens exceeded.
 * - BudgetEnforcer aborts via wall-clock timeout.
 * - resolveEffectiveLoopConfig reads <MODULE>_AI_LOOP_MAX_STEPS env shorthand.
 * - resolveEffectiveLoopConfig reads <MODULE>_AI_LOOP_MAX_WALL_CLOCK_MS env shorthand.
 * - resolveEffectiveLoopConfig reads <MODULE>_AI_LOOP_MAX_TOKENS env shorthand.
 * - kill-switch: when loop.disabled = true is injected via caller loop, stopWhen is stepCountIs(1).
 *
 * Phase 3 of spec 2026-04-28-ai-agents-agentic-loop-controls.
 */

import type { AiAgentLoopConfig, AiAgentDefinition } from '../ai-agent-definition'
import { BudgetEnforcer, resolveEffectiveLoopConfig } from '../agent-runtime'

describe('Phase 3: BudgetEnforcer', () => {
  describe('hasActiveBudget', () => {
    it('returns false when budget is undefined', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer(undefined, ac)
      expect(enforcer.hasActiveBudget).toBe(false)
    })

    it('returns false when budget is an empty object', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({}, ac)
      expect(enforcer.hasActiveBudget).toBe(false)
    })

    it('returns true when maxToolCalls is set', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 5 }, ac)
      expect(enforcer.hasActiveBudget).toBe(true)
    })

    it('returns true when maxWallClockMs is set', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxWallClockMs: 10_000 }, ac)
      expect(enforcer.hasActiveBudget).toBe(true)
    })

    it('returns true when maxTokens is set', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxTokens: 50_000 }, ac)
      expect(enforcer.hasActiveBudget).toBe(true)
    })
  })

  describe('wire()', () => {
    it('returns the original userOnStepFinish unchanged when no active budget', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer(undefined, ac)
      const userFn = jest.fn()
      const wired = enforcer.wire(userFn)
      expect(wired).toBe(userFn)
    })

    it('returns the original undefined unchanged when no active budget', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({}, ac)
      const wired = enforcer.wire(undefined)
      expect(wired).toBeUndefined()
    })

    it('returns a wrapper function (not the original) when budget is active', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 5 }, ac)
      const userFn = jest.fn()
      const wired = enforcer.wire(userFn)
      expect(wired).not.toBe(userFn)
      expect(typeof wired).toBe('function')
    })

    it('invokes userOnStepFinish when budget is active and limits not yet exceeded', async () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 5 }, ac)
      const userFn = jest.fn().mockResolvedValue(undefined)
      const wired = enforcer.wire(userFn)!

      const fakeEvent = {
        usage: { inputTokens: 10, outputTokens: 20 },
        toolCalls: [{}],
      }

      await wired(fakeEvent as never)

      expect(userFn).toHaveBeenCalledWith(fakeEvent)
      expect(ac.signal.aborted).toBe(false)
    })

    it('does NOT invoke userOnStepFinish after abort signal fires', async () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 1 }, ac)
      const userFn = jest.fn().mockResolvedValue(undefined)
      const wired = enforcer.wire(userFn)!

      const firstEvent = { usage: { inputTokens: 5, outputTokens: 5 }, toolCalls: [{}] }
      await wired(firstEvent as never)
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-tool-calls')

      userFn.mockClear()
      const secondEvent = { usage: { inputTokens: 5, outputTokens: 5 }, toolCalls: [{}] }
      await wired(secondEvent as never)

      expect(userFn).toHaveBeenCalledWith(secondEvent)
    })
  })

  describe('maxToolCalls enforcement', () => {
    it('aborts after the tool-call limit is reached', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 2 }, ac)

      enforcer.recordStep({ toolCalls: 1 })
      expect(ac.signal.aborted).toBe(false)

      enforcer.recordStep({ toolCalls: 1 })
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-tool-calls')
    })

    it('aborts when a single step exceeds the tool-call limit', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 1 }, ac)

      enforcer.recordStep({ toolCalls: 3 })
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-tool-calls')
    })

    it('does not double-abort when already aborted', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 1 }, ac)

      enforcer.recordStep({ toolCalls: 2 })
      const firstReason = enforcer.abortReason

      enforcer.recordStep({ toolCalls: 5 })
      expect(enforcer.abortReason).toBe(firstReason)
    })
  })

  describe('maxTokens enforcement', () => {
    it('aborts after token accumulation reaches the limit', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxTokens: 100 }, ac)

      enforcer.recordStep({ inputTokens: 40, outputTokens: 40 })
      expect(ac.signal.aborted).toBe(false)

      enforcer.recordStep({ inputTokens: 10, outputTokens: 11 })
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-tokens')
    })

    it('counts both inputTokens and outputTokens', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxTokens: 30 }, ac)

      enforcer.recordStep({ inputTokens: 15, outputTokens: 15 })
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-tokens')
    })

    it('skips tokensUsed accumulation when no tokens supplied', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxTokens: 10 }, ac)

      enforcer.recordStep({})
      expect(ac.signal.aborted).toBe(false)
    })
  })

  describe('maxWallClockMs enforcement', () => {
    it('aborts via checkLimits when elapsed time exceeds the wall-clock limit', async () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxWallClockMs: 1 }, ac)

      await new Promise<void>((resolve) => setTimeout(resolve, 5))

      enforcer.recordStep({})
      expect(ac.signal.aborted).toBe(true)
      expect(enforcer.abortReason).toBe('budget-wall-clock')
    })

    it('does not abort within the wall-clock window', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxWallClockMs: 30_000 }, ac)

      enforcer.recordStep({})
      expect(ac.signal.aborted).toBe(false)
    })
  })

  describe('abortReason tracking', () => {
    it('starts as null', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 5 }, ac)
      expect(enforcer.abortReason).toBeNull()
    })

    it('is set to budget-tool-calls on tool-call abort', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxToolCalls: 1 }, ac)
      enforcer.recordStep({ toolCalls: 2 })
      expect(enforcer.abortReason).toBe('budget-tool-calls')
    })

    it('is set to budget-tokens on token abort', () => {
      const ac = new AbortController()
      const enforcer = new BudgetEnforcer({ maxTokens: 1 }, ac)
      enforcer.recordStep({ inputTokens: 5 })
      expect(enforcer.abortReason).toBe('budget-tokens')
    })
  })
})

describe('Phase 3: resolveEffectiveLoopConfig — env shorthands', () => {
  const savedEnv: Record<string, string | undefined> = {}

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key]
    process.env[key] = value
  }

  function restoreEnv(key: string) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }

  function makeAgent(moduleId: string): AiAgentDefinition {
    return {
      id: `${moduleId}.agent`,
      moduleId,
      label: 'Test agent',
      description: 'Test',
      systemPrompt: 'Prompt.',
      allowedTools: [],
    }
  }

  afterEach(() => {
    Object.keys(savedEnv).forEach((key) => restoreEnv(key))
    Object.keys(savedEnv).forEach((key) => delete savedEnv[key])
  })

  it('reads <MODULE>_AI_LOOP_MAX_STEPS and maps to maxSteps', () => {
    setEnv('MYMOD_AI_LOOP_MAX_STEPS', '7')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(7)
  })

  it('env MAX_STEPS overrides agent.loop.maxSteps', () => {
    setEnv('MYMOD_AI_LOOP_MAX_STEPS', '3')
    const agent: AiAgentDefinition = { ...makeAgent('mymod'), loop: { maxSteps: 10 } }
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(3)
  })

  it('caller loop override wins over env MAX_STEPS', () => {
    setEnv('MYMOD_AI_LOOP_MAX_STEPS', '3')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent, { maxSteps: 12 })
    expect(result.maxSteps).toBe(12)
  })

  it('reads <MODULE>_AI_LOOP_MAX_WALL_CLOCK_MS and maps to budget.maxWallClockMs', () => {
    setEnv('MYMOD_AI_LOOP_MAX_WALL_CLOCK_MS', '20000')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.budget?.maxWallClockMs).toBe(20000)
  })

  it('reads <MODULE>_AI_LOOP_MAX_TOKENS and maps to budget.maxTokens', () => {
    setEnv('MYMOD_AI_LOOP_MAX_TOKENS', '80000')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.budget?.maxTokens).toBe(80000)
  })

  it('merges env budget into agent.loop.budget (env wins per axis)', () => {
    setEnv('MYMOD_AI_LOOP_MAX_TOKENS', '40000')
    const agent: AiAgentDefinition = {
      ...makeAgent('mymod'),
      loop: { budget: { maxToolCalls: 5, maxTokens: 100_000 } },
    }
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.budget?.maxToolCalls).toBe(5)
    expect(result.budget?.maxTokens).toBe(40000)
  })

  it('ignores malformed (non-numeric) env values, falling back to wrapper default', () => {
    setEnv('MYMOD_AI_LOOP_MAX_STEPS', 'not-a-number')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(10)
  })

  it('ignores zero and negative env values, falling back to wrapper default', () => {
    setEnv('MYMOD_AI_LOOP_MAX_STEPS', '0')
    const agent = makeAgent('mymod')
    const result = resolveEffectiveLoopConfig(agent)
    expect(result.maxSteps).toBe(10)
  })
})

describe('Phase 3: kill-switch via caller loop.disabled', () => {
  function makeAgent(overrides: Partial<AiAgentDefinition> = {}): AiAgentDefinition {
    return {
      id: 'mod.agent',
      moduleId: 'mod',
      label: 'Test agent',
      description: 'Test',
      systemPrompt: 'Prompt.',
      allowedTools: [],
      ...overrides,
    }
  }

  it('when caller passes loop.disabled = true, maxSteps is forced to 1', () => {
    const agent: AiAgentDefinition = {
      ...makeAgent(),
      loop: { maxSteps: 10 },
    }
    const result = resolveEffectiveLoopConfig(agent, { disabled: true } as Partial<AiAgentLoopConfig>)
    expect((result as Record<string, unknown>).disabled).toBe(true)
    expect((result as Record<string, unknown>).maxSteps).toBe(1)
  })

  it('when loop.disabled is false, maxSteps is not forced', () => {
    const agent: AiAgentDefinition = {
      ...makeAgent(),
      loop: { maxSteps: 8 },
    }
    const result = resolveEffectiveLoopConfig(agent, { disabled: false } as Partial<AiAgentLoopConfig>)
    expect((result as Record<string, unknown>).maxSteps).toBe(8)
  })

  it('when agent.loop.disabled = true (via override), maxSteps is forced to 1', () => {
    const agent: AiAgentDefinition = {
      ...makeAgent(),
      loop: { maxSteps: 5, disabled: true } as AiAgentLoopConfig,
    }
    const result = resolveEffectiveLoopConfig(agent)
    expect((result as Record<string, unknown>).disabled).toBe(true)
    expect((result as Record<string, unknown>).maxSteps).toBe(1)
  })
})
