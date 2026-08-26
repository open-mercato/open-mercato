/** @jest-environment node */
/**
 * `aiToolOverrides` / `aiAgentOverrides` are keyed replace-or-disable maps with two
 * failure modes, and neither is the one most readers assume:
 *
 * - a key that names an id nothing declares does NOT get dropped as stale. A non-null
 *   value under an unknown key REGISTERS a new entry: `applyToolOverrideMap` does
 *   `out.set(name, value)` unconditionally once the name matches the key, with no
 *   warning at all, and `applyAgentOverrideMap` does the same after logging
 *   `Override registers a new agent — no base entry to replace`. A typo therefore
 *   invents a contract instead of failing, which is the opposite of the shared
 *   dispatcher's `warnStaleOverrides` behaviour for every non-`ai` domain. A `null`
 *   under an unknown key behaves differently again: both functions just delete a key
 *   that was never there, so the typo is a no-op with no warning of any kind — the
 *   case `references/module-overrides.reference.ts` demonstrates, since every `ai`
 *   key it carries is `null`;
 * - a replacement whose `name`/`id` does not equal its key is skipped by
 *   `applyToolOverrideMap` / `applyAgentOverrideMap` with a log line, so the base
 *   definition silently survives and the override looks applied in source only.
 *
 * Every assertion below therefore runs the declarations through the REAL runtime
 * functions in `@open-mercato/ai-assistant` — the same `composeToolOverrideMap` →
 * `applyToolOverrideMap` pipeline the tool loader uses and the same
 * `composeAgentOverrideMap` → `applyAgentOverrideMap` pipeline the agent registry
 * uses — rather than inspecting the object literals.
 */
import {
  applyAiAgentOverrides,
  applyAiToolOverrides,
  composeAgentOverrideMap,
  composeToolOverrideMap,
  applyAgentOverrideMap,
  applyToolOverrideMap,
  resetProgrammaticOverridesForTests,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-overrides'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import aclFeatures from '../acl'
import aiTools, { TODO_SUMMARY_OVERRIDE_FEATURE, aiToolOverrides } from '../ai-tools'
import aiAgents, { TODO_ASSISTANT_OVERRIDE_FEATURE, aiAgentOverrides } from '../ai-agents'

const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))
const declaredToolNames = new Set(aiTools.map((tool) => tool.name))
const declaredAgentIds = new Set(aiAgents.map((agent) => agent.id))

/** The very instance `ai-overrides.ts` holds: `createLogger` caches per namespace. */
const overrideLogger = createLogger('ai_assistant')

const OVERRIDDEN_TOOL_NAME = 'example.get_todo_summary'
const OVERRIDDEN_AGENT_ID = 'example.todo_assistant'

function baseToolRegistry(): Map<string, AiToolDefinition> {
  return new Map(aiTools.map((tool) => [tool.name, tool]))
}

function resolvedTools(): Map<string, AiToolDefinition> {
  return applyToolOverrideMap(
    baseToolRegistry(),
    composeToolOverrideMap([{ moduleId: 'example', overrides: aiToolOverrides }]),
  )
}

function resolvedAgents(): AiAgentDefinition[] {
  return applyAgentOverrideMap(
    aiAgents,
    composeAgentOverrideMap([{ moduleId: 'example', overrides: aiAgentOverrides }]),
  )
}

describe('example AI override declarations', () => {
  afterEach(() => {
    resetProgrammaticOverridesForTests()
  })

  it('keys both maps on ids this module actually declares', () => {
    expect(Object.keys(aiToolOverrides)).toEqual([OVERRIDDEN_TOOL_NAME])
    expect(Object.keys(aiAgentOverrides)).toEqual([OVERRIDDEN_AGENT_ID])
    expect(declaredToolNames.has(OVERRIDDEN_TOOL_NAME)).toBe(true)
    expect(declaredAgentIds.has(OVERRIDDEN_AGENT_ID)).toBe(true)
  })

  it('gates both overrides on features acl.ts declares', () => {
    expect(declaredFeatureIds.has(TODO_SUMMARY_OVERRIDE_FEATURE)).toBe(true)
    expect(declaredFeatureIds.has(TODO_ASSISTANT_OVERRIDE_FEATURE)).toBe(true)
  })
})

describe('example aiToolOverrides through the real tool pipeline', () => {
  afterEach(() => {
    resetProgrammaticOverridesForTests()
  })

  it('replaces the base tool with the tightened gate, in place', () => {
    const base = baseToolRegistry().get(OVERRIDDEN_TOOL_NAME)
    expect(base?.requiredFeatures).toEqual(['example.todos.view'])

    const resolved = resolvedTools().get(OVERRIDDEN_TOOL_NAME)
    expect(resolved).toBeDefined()
    expect(resolved?.requiredFeatures).toEqual([TODO_SUMMARY_OVERRIDE_FEATURE])
  })

  it('replaces rather than adds, and leaves every other tool untouched', () => {
    const resolved = resolvedTools()
    expect(resolved.size).toBe(aiTools.length)
    const untouched = resolved.get('example.get_customer_priority')
    expect(untouched).toBe(baseToolRegistry().get('example.get_customer_priority'))
  })

  it('keeps the handler single-sourced with the base declaration', () => {
    const base = baseToolRegistry().get(OVERRIDDEN_TOOL_NAME)
    const resolved = resolvedTools().get(OVERRIDDEN_TOOL_NAME)
    expect(resolved?.handler).toBe(base?.handler)
    expect(resolved?.isMutation).toBe(false)
  })

  /**
   * Pins the first failure mode in this file's header: an unknown key is NOT skipped as
   * stale — the runtime registers it as a new tool, silently. That is why every key in
   * `references/module-overrides.reference.ts` is cross-checked by a test rather than
   * trusted to fail loudly at runtime.
   */
  it('registers a brand-new tool when the key names nothing, instead of skipping it', () => {
    const base = baseToolRegistry().get(OVERRIDDEN_TOOL_NAME) as AiToolDefinition
    const invented = { ...base, name: 'example.not_a_declared_tool' }
    expect(declaredToolNames.has(invented.name)).toBe(false)

    const resolved = applyToolOverrideMap(baseToolRegistry(), { [invented.name]: invented })
    expect(resolved.has(invented.name)).toBe(true)
    expect(resolved.size).toBe(aiTools.length + 1)
  })

  /**
   * The other half of the same key, and the shape `references/module-overrides.reference.ts`
   * actually carries: `null` under an unknown name deletes nothing and warns about nothing,
   * so a typo there is invisible rather than contract-inventing.
   */
  it('silently no-ops a null under a name nothing declares, without warning', () => {
    const warn = jest.spyOn(overrideLogger, 'warn')
    expect(declaredToolNames.has('example.not_a_declared_tool')).toBe(false)

    const resolved = applyToolOverrideMap(baseToolRegistry(), {
      'example.not_a_declared_tool': null,
    })
    expect(Array.from(resolved.keys())).toEqual(aiTools.map((tool) => tool.name))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('is superseded by the programmatic tier, proving it is a default and not a final word', () => {
    const disabledEverywhere = { ...aiToolOverrides[OVERRIDDEN_TOOL_NAME] } as AiToolDefinition
    applyAiToolOverrides({ [OVERRIDDEN_TOOL_NAME]: null })
    const resolved = applyToolOverrideMap(
      baseToolRegistry(),
      composeToolOverrideMap([{ moduleId: 'example', overrides: aiToolOverrides }]),
    )
    expect(resolved.has(OVERRIDDEN_TOOL_NAME)).toBe(false)
    expect(disabledEverywhere.name).toBe(OVERRIDDEN_TOOL_NAME)
  })
})

describe('example aiAgentOverrides through the real agent pipeline', () => {
  afterEach(() => {
    resetProgrammaticOverridesForTests()
  })

  it('replaces the base agent with the tightened gate and keeps the registry size', () => {
    expect(aiAgents[0].requiredFeatures).toEqual(['example.todos.view'])

    const resolved = resolvedAgents()
    expect(resolved).toHaveLength(aiAgents.length)
    const agent = resolved.find((entry) => entry.id === OVERRIDDEN_AGENT_ID)
    expect(agent).toBeDefined()
    expect(agent?.requiredFeatures).toEqual([TODO_ASSISTANT_OVERRIDE_FEATURE])
  })

  it('carries the base prompt, whitelist and read-only policy through the replacement', () => {
    const agent = resolvedAgents().find((entry) => entry.id === OVERRIDDEN_AGENT_ID)
    expect(agent?.systemPrompt).toBe(aiAgents[0].systemPrompt)
    expect(agent?.allowedTools).toEqual(aiAgents[0].allowedTools)
    expect(agent?.readOnly).toBe(true)
    expect(agent?.mutationPolicy).toBe('read-only')
  })

  it('is superseded by the programmatic tier', () => {
    applyAiAgentOverrides({ [OVERRIDDEN_AGENT_ID]: null })
    const resolved = applyAgentOverrideMap(
      aiAgents,
      composeAgentOverrideMap([{ moduleId: 'example', overrides: aiAgentOverrides }]),
    )
    expect(resolved.map((entry) => entry.id)).not.toContain(OVERRIDDEN_AGENT_ID)
  })

  /** The agent half of the same failure mode — registered, and only then warned about. */
  it('registers a brand-new agent when the key names nothing, instead of skipping it', () => {
    const invented = { ...aiAgents[0], id: 'example.not_a_declared_agent' }
    expect(declaredAgentIds.has(invented.id)).toBe(false)

    const resolved = applyAgentOverrideMap(aiAgents, { [invented.id]: invented })
    expect(resolved.map((entry) => entry.id)).toContain(invented.id)
    expect(resolved).toHaveLength(aiAgents.length + 1)
  })

  /**
   * `applyAgentOverrideMap` guards its warning with `value !== null`, so the disable
   * shape the reference uses loses even the `Override registers a new agent` line.
   */
  it('silently no-ops a null under an id nothing declares, without warning', () => {
    const warn = jest.spyOn(overrideLogger, 'warn')
    expect(declaredAgentIds.has('example.not_a_declared_agent')).toBe(false)

    const resolved = applyAgentOverrideMap(aiAgents, { 'example.not_a_declared_agent': null })
    expect(resolved.map((entry) => entry.id)).toEqual(aiAgents.map((agent) => agent.id))
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('would be skipped by the runtime if the replacement id stopped matching its key', () => {
    // Pins the invariant the file relies on: `applyAgentOverrideMap` compares the
    // replacement's `id` to the map key and keeps the BASE entry when they differ.
    const mismatched = applyAgentOverrideMap(aiAgents, {
      [OVERRIDDEN_AGENT_ID]: { ...aiAgents[0], id: 'example.some_other_agent' },
    })
    const agent = mismatched.find((entry) => entry.id === OVERRIDDEN_AGENT_ID)
    expect(agent).toBe(aiAgents[0])
  })
})
