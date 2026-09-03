/**
 * Source-level invariants for the data-honesty aggregates pass: the cockpit
 * pages must read server aggregates, never silent 100-row client samples
 * (module precedent: p0-honesty-safety.test.ts).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const MODULE_ROOT = join(__dirname, '..')

function sourceOf(relativePath: string): string {
  return readFileSync(join(MODULE_ROOT, relativePath), 'utf8')
}

describe('traces list page (backend/traces/page.tsx)', () => {
  const source = sourceOf('backend/traces/page.tsx')

  it('is server-paginated — the pageSize=100 client slice is gone', () => {
    expect(source).not.toContain("pageSize: '100'")
    expect(source).toContain('SORT_PARAMS')
    expect(source).toContain('page: String(page)')
  })

  it('reads window KPIs from /metrics/overview instead of client math', () => {
    expect(source).toContain('/api/agent_orchestrator/metrics/overview')
    expect(source).not.toMatch(/Math\.ceil\(0\.95/)
  })

  it('renders a forbidden note for the KPI strip, never fake zeros', () => {
    expect(source).toContain('traces.kpi.forbidden')
    expect(source).toContain('kpiCall.status === 403')
  })

  it('drives the needs-review facet server-side', () => {
    expect(source).toContain("filter: 'needs-review'")
  })
})

describe('agents registry page (backend/agents/page.tsx)', () => {
  const source = sourceOf('backend/agents/page.tsx')

  it('reads per-agent metrics from the batch endpoint, not a global 100-row sample', () => {
    expect(source).toContain('/api/agent_orchestrator/metrics/agents')
    expect(source).not.toContain('runs?pageSize=100')
    expect(source).not.toContain('proposals?pageSize=100')
  })

  it('renders real eval-pass and cost cells (no stale Needs-backend chips)', () => {
    expect(source).not.toContain('agents.list.pending.backend')
  })
})

describe('agents detail page (backend/agents/[id]/page.tsx)', () => {
  const source = sourceOf('backend/agents/[id]/page.tsx')

  it('fetches windowed KPIs via the batch metrics endpoint (single id)', () => {
    expect(source).toContain('/api/agent_orchestrator/metrics/agents')
    expect(source).toContain('mapAgentWindowMetrics')
  })
})

describe('overview page (backend/overview/page.tsx)', () => {
  const source = sourceOf('backend/overview/page.tsx')

  it('uses one batched metrics call — the per-agent N+1 fan-out is gone', () => {
    expect(source).toContain('/api/agent_orchestrator/metrics/agents')
    expect(source).not.toMatch(/agents\/\$\{encodeURIComponent\(id\)\}\/metrics/)
  })
})

describe('audit page (backend/audit/page.tsx)', () => {
  const source = sourceOf('backend/audit/page.tsx')

  it('is a server-paginated proposals list with org-level KPIs', () => {
    expect(source).toContain("sortField: 'createdAt'")
    expect(source).toContain('/api/agent_orchestrator/metrics/overview')
    expect(source).not.toContain('proposals?pageSize=100')
    expect(source).not.toContain('runs?pageSize=100')
  })

  it('has no dead Filters/Export buttons and no sample-scoped free-text search', () => {
    expect(source).not.toContain('actions.filters')
    expect(source).not.toContain('actions.export')
    expect(source).not.toContain('searchPlaceholder')
  })

  it('renders the corrections KPI and the server-pagination note', () => {
    expect(source).toContain('audit.kpi.corrections')
    expect(source).toContain('audit.log.serverPaginatedNote')
  })

  it('gates the open-process row action on a real processId', () => {
    expect(source).not.toContain('row.processId ?? row.id')
  })
})
