/** @jest-environment node */
import { metadata as overviewMeta } from '../backend/overview/page.meta'
import { metadata as caseloadMeta } from '../backend/caseload/page.meta'
import { metadata as processesMeta } from '../backend/processes/page.meta'
import { metadata as tracesMeta } from '../backend/traces/page.meta'
import { metadata as agentsMeta } from '../backend/agents/page.meta'
import { metadata as playgroundMeta } from '../backend/playground/page.meta'
import { metadata as agenticTasksMeta } from '../backend/agentic-tasks/page.meta'
import { metadata as evalAssertionsMeta } from '../backend/eval-assertions/page.meta'
import { metadata as evalCasesMeta } from '../backend/eval-cases/page.meta'
import { metadata as auditMeta } from '../backend/audit/page.meta'

// Navigation-pass spec §6 (2026-07-12-ux-navigation-pass): the AGENTS sidebar
// group is ordered by persona priority — Overview and Caseload first, engineer
// and admin tooling after. The shell's nav builder sorts group items by
// `pagePriority ?? pageOrder` (packages/ui/src/backend/utils/nav.ts sortItems)
// and falls back to ALPHABETICAL titles on ties, which is exactly the
// regression the audit observed when every meta carried the same priority.
const ladder = [
  ['overview', overviewMeta],
  ['caseload', caseloadMeta],
  ['processes', processesMeta],
  ['traces', tracesMeta],
  ['agents', agentsMeta],
  ['playground', playgroundMeta],
  ['agentic-tasks', agenticTasksMeta],
  ['eval-assertions', evalAssertionsMeta],
  ['eval-cases', evalCasesMeta],
  ['audit', auditMeta],
] as const

describe('agent_orchestrator sidebar ordering', () => {
  it('gives every page a distinct pagePriority (ties fall back to alphabetical order)', () => {
    const priorities = ladder.map(([, meta]) => meta.pagePriority)
    expect(priorities.every((value) => typeof value === 'number')).toBe(true)
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  it('orders pages by persona priority: operator surfaces first, admin tooling last', () => {
    const priorities = ladder.map(([, meta]) => meta.pagePriority as number)
    const sorted = [...priorities].sort((a, b) => a - b)
    expect(priorities).toEqual(sorted)
  })

  it('keeps the pageOrder ladder aligned with pagePriority ranking', () => {
    const orders = ladder.map(([, meta]) => meta.pageOrder as number)
    const sorted = [...orders].sort((a, b) => a - b)
    expect(orders).toEqual(sorted)
  })

  it('keeps the audit page visible in the sidebar with a translated label', () => {
    expect(auditMeta.navHidden).toBeUndefined()
    expect(auditMeta.pageTitleKey).toBe('agent_orchestrator.nav.audit')
    expect(auditMeta.breadcrumb?.[0]?.labelKey).toBe('agent_orchestrator.nav.audit')
  })
})
