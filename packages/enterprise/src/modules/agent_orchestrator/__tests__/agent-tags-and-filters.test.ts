/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_TAGS_MAX_COUNT, AGENT_TAG_MAX_LENGTH, normalizeAgentTag, normalizeAgentTags } from '../data/agentTags'
import { agentIconWriteSchema } from '../data/validators'
import {
  collectAgentTagOptions,
  filterAgentRows,
  matchesAgentFilters,
  matchesAgentSearch,
  type AgentFilterableRow,
} from '../backend/agents/agentListFilters'

function row(overrides: Partial<AgentFilterableRow> & Pick<AgentFilterableRow, 'id'>): AgentFilterableRow {
  return {
    label: overrides.id,
    description: '',
    resultKind: 'researcher',
    runtime: 'in-process',
    autonomy: 'auto',
    status: 'new',
    tags: [],
    ...overrides,
  }
}

describe('agent tags', () => {
  it('trims, collapses whitespace and lowercases so equivalent spellings compare equal', () => {
    expect(normalizeAgentTag('  Sales   Ops ')).toBe('sales ops')
    expect(normalizeAgentTag('SALES OPS')).toBe(normalizeAgentTag('sales ops'))
  })

  it('caps a single tag at the stored column length', () => {
    expect(normalizeAgentTag('x'.repeat(AGENT_TAG_MAX_LENGTH + 10))).toHaveLength(AGENT_TAG_MAX_LENGTH)
  })

  it('drops blanks and non-strings, and dedupes keeping the first occurrence', () => {
    expect(normalizeAgentTags(['billing', '  ', 'Billing', 42, null, 'support'])).toEqual(['billing', 'support'])
  })

  it('caps the list length', () => {
    const many = Array.from({ length: AGENT_TAGS_MAX_COUNT + 5 }, (_, index) => `tag-${index}`)
    expect(normalizeAgentTags(many)).toHaveLength(AGENT_TAGS_MAX_COUNT)
  })

  it('treats a non-array as no tags rather than throwing', () => {
    expect(normalizeAgentTags(undefined)).toEqual([])
    expect(normalizeAgentTags('billing')).toEqual([])
  })
})

describe('agent settings write schema', () => {
  it('accepts a tags-only body so the tag editor need not restate the icon', () => {
    const parsed = agentIconWriteSchema.safeParse({ tags: ['billing'] })
    expect(parsed.success).toBe(true)
  })

  it('still accepts the icon-only body older clients send', () => {
    const parsed = agentIconWriteSchema.safeParse({ icon: 'bot', updatedAt: null })
    expect(parsed.success).toBe(true)
  })

  it('rejects more tags than the stored cap', () => {
    const many = Array.from({ length: AGENT_TAGS_MAX_COUNT + 1 }, (_, index) => `tag-${index}`)
    expect(agentIconWriteSchema.safeParse({ tags: many }).success).toBe(false)
  })
})

describe('agents registry filtering', () => {
  const rows: AgentFilterableRow[] = [
    row({ id: 'deals.health', label: 'Deal health', runtime: 'in-process', resultKind: 'proposal', status: 'good', autonomy: 'review', tags: ['sales', 'billing'] }),
    row({ id: 'support.triage', label: 'Ticket triage', runtime: 'business-harness', resultKind: 'researcher', status: 'watch', autonomy: 'auto', tags: ['support'] }),
    row({ id: 'ops.audit', label: 'Ops audit', description: 'Reviews billing exports', runtime: 'native', resultKind: 'researcher', status: 'poor', autonomy: 'auto' }),
  ]

  it('matches search against id, label, description and tags', () => {
    expect(matchesAgentSearch(rows[0], 'DEAL')).toBe(true)
    expect(matchesAgentSearch(rows[0], 'sales')).toBe(true)
    expect(matchesAgentSearch(rows[2], 'billing')).toBe(true)
    expect(matchesAgentSearch(rows[1], 'billing')).toBe(false)
  })

  it('keeps every row when no filter is set', () => {
    expect(filterAgentRows(rows, '', {})).toHaveLength(3)
    expect(filterAgentRows(rows, '   ', { runtime: [], tags: [] })).toHaveLength(3)
  })

  it('ORs values inside a facet and ANDs across facets', () => {
    expect(filterAgentRows(rows, '', { runtime: ['business-harness', 'native'] }).map((r) => r.id)).toEqual([
      'support.triage',
      'ops.audit',
    ])
    expect(
      filterAgentRows(rows, '', { runtime: ['business-harness', 'native'], status: ['poor'] }).map((r) => r.id),
    ).toEqual(['ops.audit'])
  })

  it('filters by tag, matching any selected tag', () => {
    expect(filterAgentRows(rows, '', { tags: ['billing'] }).map((r) => r.id)).toEqual(['deals.health'])
    expect(filterAgentRows(rows, '', { tags: ['billing', 'support'] }).map((r) => r.id)).toEqual([
      'deals.health',
      'support.triage',
    ])
    expect(filterAgentRows(rows, '', { tags: ['unused'] })).toHaveLength(0)
  })

  it('normalizes an incoming tag value so a differently-cased pick still matches', () => {
    expect(matchesAgentFilters(rows[0], { tags: ['  BILLING '] })).toBe(true)
  })

  it('combines search with filters', () => {
    expect(filterAgentRows(rows, 'audit', { runtime: ['business-harness'] })).toHaveLength(0)
    expect(filterAgentRows(rows, 'audit', { runtime: ['native'] }).map((r) => r.id)).toEqual(['ops.audit'])
  })

  it('collects the distinct tag options in sorted order', () => {
    expect(collectAgentTagOptions(rows)).toEqual(['billing', 'sales', 'support'])
  })
})

describe('agent tag translations', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const locales = ['en', 'es', 'de', 'pl'] as const
  const keys = [
    'agent_orchestrator.agents.list.col.tags',
    'agent_orchestrator.agents.list.entityPlural',
    'agent_orchestrator.agents.list.searchPlaceholder',
    'agent_orchestrator.agents.tags.error',
    'agent_orchestrator.agents.tags.filterPlaceholder',
    'agent_orchestrator.agents.tags.label',
    'agent_orchestrator.agents.tags.placeholder',
    'agent_orchestrator.agents.tags.saved',
  ]

  it.each(locales)('%s carries every tag key', (locale) => {
    const data = JSON.parse(
      fs.readFileSync(path.join(moduleRoot, `i18n/${locale}.json`), 'utf8'),
    ) as Record<string, string>
    for (const key of keys) expect(data[key]).toBeTruthy()
  })
})
