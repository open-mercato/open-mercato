import type { AdvancedFilterTree, FilterGroup, FilterRule } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { compileTreeToWhere } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { buildDealsListHref, readDealsListUrlState } from '../dealsListHref'

const OWNER_ID = '0c5e7a1e-4b8d-4a1c-9d2e-1f3a5b7c9d01'
const PIPELINE_ID = '1d6f8b2f-5c9e-4b2d-8e3f-2a4b6c8d0e12'
const PERSON_ID = '2e7a9c3a-6d0f-4c3e-9f4a-3b5c7d9e1f23'
const COMPANY_ID = '3f8b0d4b-7e1a-4d4f-8a5b-4c6d8e0f2a34'

type RuleSummary = { field: string; operator: string; value: unknown }

function hydrate(href: string) {
  const [path, query = ''] = href.split('?')
  return { path, state: readDealsListUrlState(new URLSearchParams(query)) }
}

function rulesOf(tree: AdvancedFilterTree): RuleSummary[] {
  const out: RuleSummary[] = []
  const walk = (node: FilterGroup | FilterRule) => {
    if (node.type === 'rule') out.push({ field: node.field, operator: node.operator, value: node.value })
    else node.children.forEach(walk)
  }
  walk(tree.root)
  return out
}

describe('buildDealsListHref', () => {
  it('round-trips a chosen status, owner, pipeline and plain params through the List hydration', () => {
    const href = buildDealsListHref({
      search: '  acme ',
      status: ['open', 'win'],
      pipelineId: PIPELINE_ID,
      ownerUserId: [OWNER_ID],
      personId: [PERSON_ID],
      companyId: [COMPANY_ID],
      excludeClosed: true,
      hasExpectedCloseAt: false,
    })
    const { path, state } = hydrate(href)
    expect(path).toBe('/backend/customers/deals')
    expect(state.search).toBe('acme')
    expect(state.personIds).toEqual([PERSON_ID])
    expect(state.companyIds).toEqual([COMPANY_ID])
    expect(state.hasExpectedCloseAt).toBe(false)
    expect(state.needsAttention).toBe(false)
    expect(state.filterTree.root.combinator).toBe('and')
    const rules = rulesOf(state.filterTree)
    expect(rules).toHaveLength(3)
    expect(rules[0].field).toBe('status')
    expect(rules[0].operator).toBe('is_any_of')
    expect(rules[0].value).toEqual(expect.arrayContaining(['open', 'win', 'won']))
    expect(rules[1]).toEqual({ field: 'owner_user_id', operator: 'is_any_of', value: [OWNER_ID] })
    expect(rules[2]).toEqual({ field: 'pipeline_id', operator: 'is_any_of', value: [PIPELINE_ID] })
  })

  it('encodes excludeClosed as a status is_none_of closed-set condition including aliases', () => {
    const href = buildDealsListHref({ status: [], excludeClosed: true, hasExpectedCloseAt: false })
    const { state } = hydrate(href)
    const rules = rulesOf(state.filterTree)
    expect(rules).toHaveLength(1)
    expect(rules[0].field).toBe('status')
    expect(rules[0].operator).toBe('is_none_of')
    expect(rules[0].value).toEqual(expect.arrayContaining(['win', 'won', 'lost', 'loose', 'closed']))
    expect(rules[0].value).not.toContain('open')
    const where = compileTreeToWhere(state.filterTree)
    expect(JSON.stringify(where)).toContain('$nin')
  })

  it('omits the status condition for All deals with no status chosen', () => {
    const href = buildDealsListHref({ status: [], excludeClosed: false })
    const { state } = hydrate(href)
    expect(rulesOf(state.filterTree)).toEqual([])
    expect(href).toBe('/backend/customers/deals')
  })

  it('encodes a half-open close-date period that excludes a deal at exactly `to`', () => {
    const href = buildDealsListHref({
      excludeClosed: false,
      closeDateRange: { from: '2026-11-01', to: '2026-12-01' },
    })
    const { state } = hydrate(href)
    const rules = rulesOf(state.filterTree)
    expect(rules).toEqual([
      { field: 'expected_close_at', operator: 'between', value: ['2026-11-01', '2026-12-01'] },
      { field: 'expected_close_at', operator: 'is_before', value: '2026-12-01' },
    ])
    const where = compileTreeToWhere(state.filterTree) as Record<string, unknown>
    const conditions = JSON.stringify(where)
    expect(conditions).toContain('"$lt":"2026-12-01"')
    expect(conditions).toContain('"$gte":"2026-11-01"')
  })

  it('reads an absent or unknown hasExpectedCloseAt as null and accepts the shared boolean tokens', () => {
    expect(readDealsListUrlState(new URLSearchParams('')).hasExpectedCloseAt).toBeNull()
    expect(readDealsListUrlState(new URLSearchParams('hasExpectedCloseAt=maybe')).hasExpectedCloseAt).toBeNull()
    expect(readDealsListUrlState(new URLSearchParams('hasExpectedCloseAt=1')).hasExpectedCloseAt).toBe(true)
    expect(readDealsListUrlState(new URLSearchParams('hasExpectedCloseAt=false')).hasExpectedCloseAt).toBe(false)
    expect(readDealsListUrlState(new URLSearchParams('hasExpectedCloseAt=true')).hasExpectedCloseAt).toBe(true)
    expect(readDealsListUrlState(null).filterTree.root.children).toEqual([])
  })
})
