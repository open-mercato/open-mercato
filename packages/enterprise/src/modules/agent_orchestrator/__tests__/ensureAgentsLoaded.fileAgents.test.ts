/**
 * Regression test for the bug where file-defined (OpenCode) agents never appeared
 * in the Agents registry: `ensureAgentsLoaded()` short-circuited on
 * `registry.size > 0`, but in-process agents populate that registry first via
 * `ai-agents.ts` import side-effects (e.g. the global AiAssistantLauncher hitting
 * `loadAgentRegistry()` on every backoffice page). The early return then starved
 * `loadFileAgents()`, so `runtime: 'opencode'` agents were never registered.
 *
 * This test reproduces the condition (registry pre-populated) and asserts the
 * opencode agent still loads.
 */

// Avoid loading the real in-process aggregator / app-generated registry.
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => {}),
}))
// Keep the propose-only mutation predicate cheap (the demo agent declares no tools).
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTool: () => undefined }),
}))
// Recompiling the outcome schema is exercised elsewhere; stub it here.
jest.mock('../lib/sdk/outcomeSchema', () => ({
  compileOutcome: () => ({ resultSchema: { _stub: true } }),
}))
jest.mock('../lib/runtime/fileAgentSkills', () => ({
  registerAgentSkills: jest.fn(),
}))
// The committed manifest, replaced with a single opencode descriptor (no tools).
jest.mock('../generated/file-agents.generated', () => ({
  fileAgentDescriptors: [
    {
      id: 'demo.opencode_agent',
      moduleId: 'agent_examples',
      resultKind: 'informative',
      outcomeSchema: { type: 'object', properties: {} },
      tools: [],
      skills: [],
      subAgents: [],
      label: 'Demo OpenCode Agent',
      description: 'A file-defined agent that runs on OpenCode.',
      instructions: 'Be helpful.',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      maxSteps: null,
      skillsContent: [],
      subAgentDescriptors: [],
    },
  ],
}))

import {
  registerFileAgent,
  ensureAgentsLoaded,
  listAgentEntries,
  type AgentRegistryEntry,
} from '../lib/sdk/defineAgent'

test('ensureAgentsLoaded registers opencode file agents even when the registry was already populated by an in-process agent', async () => {
  // Simulate an in-process agent registered first via import side-effect.
  const inProcess: AgentRegistryEntry = {
    id: 'demo.in_process_agent',
    moduleId: 'agent_examples',
    resultKind: 'informative',
    schema: { _stub: true } as never,
    tools: [],
    skills: [],
    subAgents: [],
    label: 'In-process',
    description: '',
    instructions: '',
    runtime: 'in-process',
  }
  registerFileAgent(inProcess)
  // Pre-populated → the old `registry.size > 0` guard would skip file loading.
  expect(listAgentEntries()).toHaveLength(1)

  await ensureAgentsLoaded()

  const entries = listAgentEntries()
  const opencode = entries.find((entry) => entry.id === 'demo.opencode_agent')
  expect(opencode).toBeDefined()
  expect(opencode?.runtime).toBe('opencode')
  // Both runtimes coexist in the same registry.
  expect(entries.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['demo.in_process_agent', 'demo.opencode_agent']),
  )
})
