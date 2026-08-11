/**
 * The taxonomy SURFACES (spec `2026-08-11-agent-taxonomy.md`, Phase 4 steps 12 + 13).
 *
 * Phase 3 made `agentType` and the narrowed `allowedActions` authoring facts an
 * agent carries BEFORE it runs; until a surface reads them they buy nothing. And a
 * trace that records only "approved" hides the decision that was actually made:
 * with N ranked alternatives the interesting facts are WHICH option ran and WHO
 * chose it (`disposition_by`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapAgent, mapProposal } from '../components/types'

const MODULE_ROOT = join(__dirname, '..')
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

function read(relative: string): string {
  return readFileSync(join(MODULE_ROOT, relative), 'utf8')
}

function locale(name: (typeof LOCALES)[number]): Record<string, string> {
  return JSON.parse(read(join('i18n', `${name}.json`)))
}

describe('the agents API projects the declared type and the narrowed vocabulary', () => {
  const listRoute = read('api/agents/route.ts')
  const detailRoute = read('api/agents/[id]/route.ts')

  it.each([
    ['list', listRoute],
    ['detail', detailRoute],
  ])('%s route emits agentType + allowedActions', (_name, source) => {
    expect(source).toContain('agentType: entry.agentType ?? null')
    expect(source).toContain('allowedActions: entry.allowedActions ? [...entry.allowedActions] : null')
    expect(source).toContain('agentType: agentTypeSchema.nullable()')
    expect(source).toContain('allowedActions: z.array(z.string()).nullable()')
  })

  it('maps an undeclared type to null rather than inventing a declaration', () => {
    const base = { id: 'a', label: 'A', description: '', resultKind: 'proposal', runtime: 'in-process' }
    expect(mapAgent({ ...base })?.agentType).toBeNull()
    expect(mapAgent({ ...base, agentType: 'not_a_type' })?.agentType).toBeNull()
    expect(mapAgent({ ...base, agentType: 'decision_maker' })?.agentType).toBe('decision_maker')
  })

  it('keeps "no narrowing" (null) distinct from "nothing survived" (empty)', () => {
    const base = { id: 'a', label: 'A', description: '', resultKind: 'proposal', runtime: 'in-process' }
    expect(mapAgent(base)?.allowedActions).toBeNull()
    expect(mapAgent({ ...base, allowedActions: [] })?.allowedActions).toEqual([])
    expect(mapAgent({ ...base, allowedActions: ['set_stage'] })?.allowedActions).toEqual(['set_stage'])
  })
})

describe('the agents list and detail render the taxonomy', () => {
  it('lists the declared type as its own column and filter facet', () => {
    const page = read('backend/agents/page.tsx')
    expect(page).toContain("accessorKey: 'agentType'")
    expect(page).toContain('agent_orchestrator.agents.list.col.agentType')
    expect(page).toContain('agent_orchestrator.agents.list.agentType.${agentType}')
    expect(page).toContain('AGENT_TYPE_UNDECLARED')
  })

  it('filters on the declared type, treating undeclared as its own value', () => {
    const filters = read('backend/agents/agentListFilters.ts')
    expect(filters).toContain('AGENT_TYPE_UNDECLARED')
    expect(filters).toMatch(/agentTypes\.length && !agentTypes\.includes\(row\.agentType \?\? AGENT_TYPE_UNDECLARED\)/)
  })

  it('shows the type and the narrowed action vocabulary on the agent detail', () => {
    const tab = read('backend/agents/[id]/components/ConfigurationTab.tsx')
    expect(tab).toContain('agent_orchestrator.agentDetail.config.agentType')
    expect(tab).toContain('agent_orchestrator.agentDetail.fields.allowedActions')
    // The three states must read differently: full catalogue, narrowed list, nothing.
    expect(tab).toContain('agent_orchestrator.agentDetail.allowedActions.catalogue')
    expect(tab).toContain('agent_orchestrator.agentDetail.allowedActions.narrowed')
    expect(tab).toContain('agent_orchestrator.agentDetail.allowedActions.none')
    expect(tab).toMatch(/agent\.allowedActions == null/)
    expect(tab).toMatch(/agent\.allowedActions\.length === 0/)
  })
})

describe('the trace shows which option was chosen and by whom', () => {
  const page = read('backend/traces/[id]/page.tsx')

  it('renders a disposition card off the run\'s proposals', () => {
    expect(page).toContain('function DispositionCard(')
    expect(page).toContain('<DispositionCard proposals={detail.proposals} />')
  })

  it('names the chosen option and the actor behind the verdict', () => {
    expect(page).toContain('agent_orchestrator.traces.detail.chosenOption')
    expect(page).toContain('agent_orchestrator.traces.detail.disposedBy')
    expect(page).toContain('proposal.dispositionBy')
    // An auto-approval is a RULE, not a person — showing `rule:threshold` raw
    // would read as a user id.
    expect(page).toMatch(/proposal\.dispositionBy === 'rule:threshold'/)
    expect(page).toContain('agent_orchestrator.traces.detail.disposedByRule')
  })

  it('carries the near_tie explanation onto the trace too', () => {
    expect(page).toContain("proposal.autoDispositionBlock === 'near_tie'")
    expect(page).toContain('agent_orchestrator.proposal.options.nearTie')
  })

  it('maps the disposition columns onto the proposal view', () => {
    const mapped = mapProposal({
      id: 'p1',
      agent_id: 'a',
      run_id: 'r',
      selected_option_id: 'hold',
      auto_disposition_block: 'near_tie',
      disposition_by: 'rule:threshold',
    })
    expect(mapped?.selectedOptionId).toBe('hold')
    expect(mapped?.autoDispositionBlock).toBe('near_tie')
    expect(mapped?.dispositionBy).toBe('rule:threshold')
    // Absent columns stay null — never coerced into a false "chosen".
    expect(mapProposal({ id: 'p1', agent_id: 'a', run_id: 'r' })?.selectedOptionId).toBeNull()
  })
})

describe('Phase 4 copy exists in every locale', () => {
  const KEYS = [
    'agent_orchestrator.proposal.options.heading',
    'agent_orchestrator.proposal.options.rank',
    'agent_orchestrator.proposal.options.confidence',
    'agent_orchestrator.proposal.options.chooseHint',
    'agent_orchestrator.proposal.options.nearTie',
    'agent_orchestrator.proposal.options.noneProposed.title',
    'agent_orchestrator.proposal.options.noneProposed.description',
    'agent_orchestrator.caseload.status.noneProposed',
    'agent_orchestrator.caseload.status.unknown',
    'agent_orchestrator.caseload.bulk.needsOption',
    'agent_orchestrator.agents.list.col.agentType',
    'agent_orchestrator.agents.list.agentType.researcher',
    'agent_orchestrator.agents.list.agentType.decision_maker',
    'agent_orchestrator.agents.list.agentType.action',
    'agent_orchestrator.agents.list.agentType.undeclared',
    'agent_orchestrator.agentDetail.config.agentType',
    'agent_orchestrator.agentDetail.fields.allowedActions',
    'agent_orchestrator.agentDetail.allowedActions.catalogue',
    'agent_orchestrator.agentDetail.allowedActions.narrowed',
    'agent_orchestrator.agentDetail.allowedActions.none',
    'agent_orchestrator.traces.detail.disposition',
    'agent_orchestrator.traces.detail.chosenOption',
    'agent_orchestrator.traces.detail.disposedBy',
    'agent_orchestrator.traces.detail.disposedByRule',
    'agent_orchestrator.traces.detail.optionsOffered',
  ]

  it.each(LOCALES)('%s carries every Phase 4 key with a non-empty value', (name) => {
    const catalog = locale(name)
    for (const key of KEYS) {
      expect(typeof catalog[key]).toBe('string')
      expect(catalog[key].trim().length).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('%s keeps the interpolation tokens the UI passes', (name) => {
    const catalog = locale(name)
    expect(catalog['agent_orchestrator.proposal.options.rank']).toContain('{rank}')
    expect(catalog['agent_orchestrator.proposal.options.confidence']).toContain('{pct}')
    expect(catalog['agent_orchestrator.proposal.options.moreActions']).toContain('{count}')
    expect(catalog['agent_orchestrator.caseload.bulk.needsOption']).toContain('{count}')
    expect(catalog['agent_orchestrator.agentDetail.allowedActions.narrowed']).toContain('{count}')
  })

  it.each(LOCALES)('%s does not label "nothing proposed" as approved', (name) => {
    const catalog = locale(name)
    expect(catalog['agent_orchestrator.caseload.status.noneProposed']).not.toBe(
      catalog['agent_orchestrator.caseload.status.approved'],
    )
  })
})
