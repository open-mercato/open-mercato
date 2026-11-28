/**
 * B-3: a file agent's GOVERNANCE.json reaches its registry entry and its native
 * definition exactly as `defineAgent` keys do, and fails closed when it cannot
 * be honoured — an invalid declaration, or governance the OpenCode runtime cannot
 * enforce on an agent that has to run there.
 */
const registerRuntimeAiAgents = jest.fn(async (definitions: Array<{ id: string }>) =>
  definitions.map((definition) => definition.id),
)

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-registry', () => ({
  loadAgentRegistry: jest.fn(async () => {}),
  registerRuntimeAiAgents: (definitions: Array<{ id: string }>) => registerRuntimeAiAgents(definitions),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader', () => ({
  loadAllModuleTools: jest.fn(async () => {}),
}))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry', () => ({
  getToolRegistry: () => ({ getTool: () => ({ isMutation: false }) }),
}))
jest.mock('../lib/runtime/fileAgentSkills', () => ({
  registerAgentSkills: jest.fn(),
  listAgentSkillIds: jest.fn(() => []),
}))

const researchSchema = {
  type: 'object',
  properties: { findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } },
}

function descriptor(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    moduleId: 'agent_examples',
    resultKind: 'research',
    outcomeSchema: researchSchema,
    tools: ['customers.get_deal'],
    skills: [],
    subAgents: [],
    label: id,
    description: 'A governed file agent.',
    instructions: 'Review the deal notes.',
    skillsContent: [],
    ...overrides,
  }
}

const fullGovernance = {
  principal: { roleFeatures: ['customers.deals.view'], toolAcl: 'intersect' },
  integrity: [
    {
      id: 'cited',
      kind: 'tool_consulted',
      cites: 'data.findings[*].id',
      tools: ['customers.get_deal'],
      returned: ['deal.id'],
    },
  ],
  untrustedInputs: [{ label: 'notes', path: 'deal.notes' }],
  modelSettings: { temperature: 0, seed: 7 },
}

jest.mock('../generated/file-agents.generated', () => ({
  fileAgentDescriptors: [
    descriptor('gov.native', { governance: fullGovernance }),
    descriptor('gov.invalid_integrity', {
      governance: {
        integrity: [
          {
            id: 'cited',
            kind: 'tool_consulted',
            cites: 'data.missing[*]',
            tools: ['customers.get_deal'],
            returned: ['deal.id'],
          },
        ],
      },
    }),
    descriptor('gov.invalid_principal', { governance: { principal: { roleFeatures: ['x.y'], grantAll: true } } }),
    descriptor('gov.invalid_model_settings', { governance: { modelSettings: { temperature: 'hot' } } }),
    descriptor('gov.artifact_model_settings', {
      resultKind: 'artifact',
      outcomeSchema: undefined,
      governance: { modelSettings: { temperature: 0 } },
    }),
    descriptor('gov.artifact_intersect', {
      resultKind: 'artifact',
      outcomeSchema: undefined,
      governance: { principal: { roleFeatures: ['customers.deals.view'], toolAcl: 'intersect' } },
    }),
    descriptor('gov.artifact_caller_principal', {
      resultKind: 'artifact',
      outcomeSchema: undefined,
      governance: { principal: { roleFeatures: ['customers.deals.view'] } },
    }),
    descriptor('gov.ungoverned'),
    descriptor('gov.parent', {
      subAgents: ['gov.child'],
      subAgentDescriptors: [
        descriptor('gov.child', {
          moduleId: '',
          governance: {
            untrustedInputs: [{ label: 'page', path: 'page' }],
            modelSettings: { temperature: 0.2 },
          },
        }),
        descriptor('gov.child_invalid', { moduleId: '', governance: { modelSettings: { seed: 'x' } } }),
      ],
    }),
  ],
}))

import { ensureAgentsLoaded, getAgentEntry } from '../lib/sdk/defineAgent'

type RegisteredDefinition = {
  id: string
  systemPrompt: string
  modelSettings?: Record<string, unknown>
}

function registeredDefinition(id: string): RegisteredDefinition | undefined {
  const batches = registerRuntimeAiAgents.mock.calls.map(([definitions]) => definitions as RegisteredDefinition[])
  return batches.flat().find((definition) => definition.id === id)
}

beforeAll(async () => {
  await ensureAgentsLoaded()
})

test('a native file agent carries its parsed governance on the registry entry', () => {
  const entry = getAgentEntry('gov.native')
  expect(entry?.runtime).toBe('native')
  expect(entry?.principal).toEqual({ roleFeatures: ['customers.deals.view'], toolAcl: 'intersect' })
  expect(entry?.integrity).toEqual([
    expect.objectContaining({ id: 'cited', kind: 'tool_consulted', returned: ['deal.id'], onViolation: 'flag' }),
  ])
  expect(entry?.untrustedInputs).toEqual([{ label: 'notes', path: 'deal.notes', injection: 'warn' }])
  expect(entry?.modelSettings).toEqual({ temperature: 0, seed: 7 })
})

test('the native definition applies the model settings and the untrusted-input instruction', () => {
  const definition = registeredDefinition('gov.native')
  expect(definition?.modelSettings).toEqual({ temperature: 0, seed: 7 })
  expect(definition?.systemPrompt).toContain('Untrusted fields: notes.')
})

test.each(['gov.invalid_integrity', 'gov.invalid_principal', 'gov.invalid_model_settings'])(
  'an agent whose governance does not validate is not registered (%s)',
  (agentId) => {
    expect(getAgentEntry(agentId)).toBeUndefined()
    expect(registeredDefinition(agentId)).toBeUndefined()
  },
)

test('an OpenCode-only agent declaring governance OpenCode cannot enforce is not registered', () => {
  expect(getAgentEntry('gov.artifact_model_settings')).toBeUndefined()
  expect(getAgentEntry('gov.artifact_intersect')).toBeUndefined()
})

test('an OpenCode-only agent whose governance OpenCode can honour still registers', () => {
  const entry = getAgentEntry('gov.artifact_caller_principal')
  expect(entry?.runtime).toBe('opencode')
  expect(entry?.principal).toEqual({ roleFeatures: ['customers.deals.view'] })
})

test('an agent without GOVERNANCE.json is unchanged', () => {
  const entry = getAgentEntry('gov.ungoverned')
  expect(entry?.runtime).toBe('native')
  expect(entry?.principal).toBeUndefined()
  expect(entry?.integrity).toBeUndefined()
  expect(entry?.untrustedInputs).toBeUndefined()
  expect(entry?.modelSettings).toBeUndefined()
  expect(registeredDefinition('gov.ungoverned')?.modelSettings).toBeUndefined()
})

test('a sub-agent carries its own GOVERNANCE.json and fails closed on its own', () => {
  const child = getAgentEntry('gov.child')
  expect(child?.runtime).toBe('native')
  expect(child?.untrustedInputs).toEqual([{ label: 'page', path: 'page', injection: 'warn' }])
  expect(child?.modelSettings).toEqual({ temperature: 0.2 })
  expect(registeredDefinition('gov.child')?.modelSettings).toEqual({ temperature: 0.2 })
  expect(getAgentEntry('gov.parent')?.untrustedInputs).toBeUndefined()
  expect(getAgentEntry('gov.child_invalid')).toBeUndefined()
})
