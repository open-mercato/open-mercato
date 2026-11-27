import { z } from 'zod'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import { applyFileAgentGovernance, listOpenCodeUnsupportedGovernance } from '../lib/sdk/fileAgentGovernance'

function entry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id: 'gov.unit',
    moduleId: 'agent_examples',
    resultKind: 'research',
    schema: z.object({ kind: z.literal('research'), data: z.object({ ids: z.array(z.string()) }) }),
    tools: ['customers.get_deal'],
    skills: [],
    subAgents: [],
    label: 'Unit',
    description: 'Unit',
    instructions: 'Unit',
    runtime: 'native',
    definitionSource: 'file',
    ...overrides,
  }
}

const enforcedRule = (tool: string) => ({
  id: 'consulted',
  kind: 'tool_consulted',
  cites: 'data.ids[*]',
  tools: [tool],
  matchArgs: true,
  enforce: 'prepare_step',
})

describe('applyFileAgentGovernance', () => {
  it('leaves an agent without governance untouched', () => {
    const target = entry()
    applyFileAgentGovernance(target, undefined, { hasSkills: false })
    expect(target.principal).toBeUndefined()
    expect(target.integrity).toBeUndefined()
  })

  it('requires an enforced tool_consulted rule to name a tool the agent can reach', () => {
    expect(() =>
      applyFileAgentGovernance(entry(), { integrity: [enforcedRule('agent_orchestrator.load_skill')] }, { hasSkills: false }),
    ).toThrow(/enforce "prepare_step" requires/)
    const withSkills = entry()
    applyFileAgentGovernance(withSkills, { integrity: [enforcedRule('agent_orchestrator.load_skill')] }, { hasSkills: true })
    expect(withSkills.integrity?.[0]).toMatchObject({ id: 'consulted', enforce: 'prepare_step' })
  })

  it('rejects a principal that tries to declare anything beyond the schema', () => {
    expect(() =>
      applyFileAgentGovernance(entry(), { principal: { roleFeatures: ['customers.deals.view'], isSuperAdmin: true } }, { hasSkills: false }),
    ).toThrow(/invalid principal/)
  })
})

describe('listOpenCodeUnsupportedGovernance', () => {
  it('names every declaration OpenCode cannot enforce', () => {
    const target = entry()
    applyFileAgentGovernance(
      target,
      {
        principal: { roleFeatures: ['customers.deals.view'], toolAcl: 'intersect' },
        integrity: [enforcedRule('customers.get_deal')],
        untrustedInputs: [{ label: 'notes', path: 'notes' }],
        modelSettings: { temperature: 0 },
      },
      { hasSkills: false },
    )
    expect(listOpenCodeUnsupportedGovernance(target)).toEqual([
      'untrustedInputs',
      'modelSettings',
      'principal.toolAcl=intersect',
      'integrity.enforce=prepare_step',
    ])
  })

  it('accepts a caller-mode principal and post-hoc integrity rules', () => {
    const target = entry()
    applyFileAgentGovernance(
      target,
      {
        principal: { roleFeatures: ['customers.deals.view'], toolAcl: 'caller' },
        integrity: [{ id: 'consulted', kind: 'tool_consulted', cites: 'data.ids[*]', tools: ['customers.get_deal'], matchArgs: true }],
      },
      { hasSkills: false },
    )
    expect(listOpenCodeUnsupportedGovernance(target)).toEqual([])
  })
})
