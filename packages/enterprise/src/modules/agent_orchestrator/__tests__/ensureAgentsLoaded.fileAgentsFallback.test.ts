/**
 * A native file agent whose read-only definition the ai-assistant registry did
 * not accept — another module already owns the id, or the registry is broken —
 * must NOT run natively: `runAiAgentObject` would either fail or execute that
 * other agent's definition. The loader moves it back to OpenCode instead.
 */
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => {}),
  registerRuntimeAiAgents: jest.fn(async () => []),
}))
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

import { ensureAgentsLoaded, getAgentEntry } from '../lib/sdk/defineAgent'

test('a file agent whose native definition was rejected falls back to OpenCode', async () => {
  await ensureAgentsLoaded()

  const entry = getAgentEntry('demo.opencode_agent')
  expect(entry).toBeDefined()
  expect(entry?.runtime).toBe('opencode')
  expect(entry?.definitionSource).toBe('file')
})
