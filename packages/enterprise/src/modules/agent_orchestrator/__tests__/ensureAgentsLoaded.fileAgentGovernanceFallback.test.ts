/**
 * B-3: when the ai-assistant registry does not accept a native file agent, the
 * loader moves it back to OpenCode. A governed agent whose declarations OpenCode
 * cannot enforce must be removed instead, never silently downgraded.
 */
process.env.OM_AGENT_TOOL_ACL_MODE = 'intersect'

const registerAgentSkills = jest.fn()

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
jest.mock('../lib/runtime/fileAgentSkills', () => ({
  registerAgentSkills: (...args: unknown[]) => registerAgentSkills(...args),
  listAgentSkillIds: jest.fn(() => []),
}))

function descriptor(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    moduleId: 'agent_examples',
    resultKind: 'research',
    outcomeSchema: { type: 'object', properties: { note: { type: 'string' } } },
    tools: [],
    skills: [],
    subAgents: [],
    label: id,
    description: 'A file agent.',
    instructions: 'Be helpful.',
    skillsContent: [],
    ...overrides,
  }
}

jest.mock('../generated/file-agents.generated', () => ({
  fileAgentDescriptors: [
    descriptor('fallback.untrusted', { governance: { untrustedInputs: [{ label: 'body', path: 'body' }] } }),
    descriptor('fallback.integrity_only', {
      governance: {
        integrity: [
          {
            id: 'needs-note',
            kind: 'abstain_or_review',
            needsReview: { when: [{ signal: 'output_empty', path: 'data.note' }] },
          },
        ],
      },
    }),
    descriptor('fallback.env_intersect', {
      governance: { principal: { roleFeatures: ['customers.deals.view'] } },
    }),
    descriptor('fallback.plain'),
  ],
}))

import { ensureAgentsLoaded, getAgentEntry, listAgentEntries } from '../lib/sdk/defineAgent'

beforeAll(async () => {
  await ensureAgentsLoaded()
})

test('a governed agent OpenCode cannot enforce is removed when it cannot run natively', () => {
  expect(getAgentEntry('fallback.untrusted')).toBeUndefined()
  expect(listAgentEntries().map((entry) => entry.id)).not.toContain('fallback.untrusted')
})

test('a removed agent leaves no registered skills behind', () => {
  expect(registerAgentSkills).toHaveBeenCalledWith('fallback.untrusted', [])
})

test('a principal without toolAcl inherits OM_AGENT_TOOL_ACL_MODE=intersect, which OpenCode cannot enforce', () => {
  expect(getAgentEntry('fallback.env_intersect')).toBeUndefined()
})

test('an agent whose governance OpenCode honours falls back to OpenCode as before', () => {
  expect(getAgentEntry('fallback.integrity_only')?.runtime).toBe('opencode')
  expect(getAgentEntry('fallback.integrity_only')?.integrity).toHaveLength(1)
  expect(getAgentEntry('fallback.plain')?.runtime).toBe('opencode')
})
