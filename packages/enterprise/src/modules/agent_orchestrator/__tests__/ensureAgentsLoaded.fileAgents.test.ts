/**
 * Regression test for the bug where file-defined (OpenCode) agents never appeared
 * in the Agents registry: `ensureAgentsLoaded()` short-circuited on
 * `registry.size > 0`, but in-process agents populate that registry first via
 * `ai-agents.ts` import side-effects (e.g. the global AiAssistantLauncher hitting
 * `loadAgentRegistry()` on every backoffice page). The early return then starved
 * `loadFileAgents()`, so `runtime: 'opencode'` agents were never registered.
 *
 * This test reproduces the condition (registry pre-populated) and asserts the
 * file agent still loads — now on the native runtime (spec Phase 3).
 */

// Avoid loading the real in-process aggregator / app-generated registry. File
// agents run natively by default, so the loader hands their read-only
// definitions to the ai-assistant registry; the mock accepts them all.
const registerRuntimeAiAgents = jest.fn(async (agents: Array<{ id: string }>) => agents.map((agent) => agent.id))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => {}),
  registerRuntimeAiAgents: (agents: Array<{ id: string }>) => registerRuntimeAiAgents(agents),
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
      resultKind: 'research',
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

test('ensureAgentsLoaded registers file agents even when the registry was already populated by an in-process agent', async () => {
  // Simulate an in-process agent registered first via import side-effect.
  const inProcess: AgentRegistryEntry = {
    id: 'demo.in_process_agent',
    moduleId: 'agent_examples',
    resultKind: 'research',
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
  const fileAgent = entries.find((entry) => entry.id === 'demo.opencode_agent')
  expect(fileAgent).toBeDefined()
  // Phase 3: file agents run on the native runtime and stay marked as file-defined.
  expect(fileAgent?.runtime).toBe('native')
  expect(fileAgent?.definitionSource).toBe('file')
  // ...with a read-only ai-assistant definition — the native propose-only gate.
  expect(registerRuntimeAiAgents).toHaveBeenCalledWith([
    expect.objectContaining({
      id: 'demo.opencode_agent',
      readOnly: true,
      mutationPolicy: 'read-only',
      executionMode: 'object',
    }),
  ])
  // Code and file agents coexist in the same registry.
  expect(entries.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['demo.in_process_agent', 'demo.opencode_agent']),
  )
})
