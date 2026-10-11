/** @jest-environment node */
import { metadata as overviewMeta } from '../backend/overview/page.meta'
import { metadata as caseloadMeta } from '../backend/caseload/page.meta'
import { metadata as processesMeta } from '../backend/processes/page.meta'
import { metadata as tracesMeta } from '../backend/traces/page.meta'
import { metadata as agentsMeta } from '../backend/agents/page.meta'
import { metadata as playgroundMeta } from '../backend/playground/page.meta'
import { metadata as processDefinitionsMeta } from '../backend/processes/definitions/page.meta'
import { metadata as auditMeta } from '../backend/audit/page.meta'

// First-run orientation spec F1 (2026-09-10-ux-first-run-orientation-feedback):
// the AGENTS sidebar group is ordered by the ORDER OF USE, not by operator
// frequency — Agents and Playground (the inputs) before Caseload and Traces
// (the outputs). This supersedes the persona-priority ladder of the 2026-07-12
// navigation pass, which put the outputs first and left first-time users with
// no idea where to start. The shell's nav builder sorts group items by
// `pagePriority ?? pageOrder` (packages/ui/src/backend/utils/nav.ts sortItems)
// and falls back to ALPHABETICAL titles on ties, which is exactly the
// regression the audit observed when every meta carried the same priority.
//
// The three eval screens (assertions/cases/evaluations) were removed from the
// sidebar (2026-07-24 agent-centric-workspace-and-eval-consolidation): evaluation
// now lives inside the agent detail page's Evaluation tab.
const ladder = [
  ['overview', overviewMeta],
  ['agents', agentsMeta],
  ['playground', playgroundMeta],
  ['processes/definitions', processDefinitionsMeta],
  ['processes', processesMeta],
  ['caseload', caseloadMeta],
  ['traces', tracesMeta],
  ['audit', auditMeta],
] as const

describe('agent_orchestrator sidebar ordering', () => {
  it('gives every page a distinct pagePriority (ties fall back to alphabetical order)', () => {
    const priorities = ladder.map(([, meta]) => meta.pagePriority)
    expect(priorities.every((value) => typeof value === 'number')).toBe(true)
    expect(new Set(priorities).size).toBe(priorities.length)
  })

  it('orders pages by the order of use: agents and playground before the queues they fill', () => {
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
