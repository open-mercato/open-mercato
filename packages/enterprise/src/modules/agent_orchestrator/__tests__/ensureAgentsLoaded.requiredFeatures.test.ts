jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTool: () => undefined }),
}))
jest.mock('../lib/sdk/outcomeSchema', () => ({
  compileOutcome: () => ({ resultSchema: { _stub: true } }),
}))
jest.mock('../lib/runtime/fileAgentSkills', () => ({
  registerAgentSkills: jest.fn(),
}))
jest.mock('../ai-agents', () => ({}))

const baseDescriptor = {
  moduleId: 'agent_examples',
  resultKind: 'research',
  outcomeSchema: { type: 'object', properties: {} },
  tools: [],
  skills: [],
  subAgents: [],
  label: 'File agent',
  description: 'A file-defined agent.',
  instructions: 'Be helpful.',
  openCodeAgentName: 'file_agent',
  skillsContent: [],
}

jest.mock('../generated/file-agents.generated', () => ({
  fileAgentDescriptors: [
    {
      ...baseDescriptor,
      id: 'demo.gated_file_agent',
      requiredFeatures: ['deals.health.run', ' deals.health.run '],
      subAgentDescriptors: [
        { ...baseDescriptor, id: 'demo.gated_sub_agent', requiredFeatures: ['customers.deals.view'] },
      ],
    },
    { ...baseDescriptor, id: 'demo.open_file_agent' },
    { ...baseDescriptor, id: 'demo.bad_file_agent', requiredFeatures: ['not a feature'] },
  ],
}))

import { ensureAgentsLoaded, getAgentEntry } from '../lib/sdk/defineAgent'

test('file agents carry their manifest requiredFeatures into the registry entry', async () => {
  await ensureAgentsLoaded()

  expect(getAgentEntry('demo.gated_file_agent')?.requiredFeatures).toEqual(['deals.health.run'])
  expect(getAgentEntry('demo.gated_sub_agent')?.requiredFeatures).toEqual(['customers.deals.view'])
  expect(getAgentEntry('demo.open_file_agent')?.requiredFeatures).toBeUndefined()
  expect(getAgentEntry('demo.bad_file_agent')).toBeUndefined()
})
