import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, summarizeDurations, suppressionReason } from './stats'
import { addCause, emptyCauseCounts, type AnalyticsEvent, type PreparedCase } from './trace'
import { XRAY_NONE_GROUP, type BreakdownResult, type CauseCounts, type XrayBreakdownGroup } from './types'

type BreakdownCell = {
  organizationId: string
  group: string
  raw: number
  collapsed: number
  cases: Set<string>
  actors: Set<string>
  causes: CauseCounts
  waits: number[]
}

function groupsOf(event: AnalyticsEvent, groupBy: XrayBreakdownGroup, organizationId: string): string[] {
  if (groupBy === 'org') return [organizationId]
  if (groupBy === 'role') return event.roleIds.length > 0 ? event.roleIds : [XRAY_NONE_GROUP]
  if (groupBy === 'team') return [event.teamId ?? XRAY_NONE_GROUP]
  return [event.actor ?? XRAY_NONE_GROUP]
}

/**
 * Activity of the window grouped by organization (default), actor role, actor team or actor
 * (per-person; callers must pass the individuals gate first). Groups are always split per
 * organization, never pooled across organizations (Simpson's paradox). An event of an actor
 * in several roles counts in each role (`overlapping`). Steps without an actor or dimension
 * fall into `none`. Group cells need k cases and, except a person's own cell, three distinct
 * actors; the step wait excludes `sync_run` transitions unless requested.
 */
export function buildBreakdown(cases: readonly PreparedCase[], context: BuildContext, groupBy: XrayBreakdownGroup): BreakdownResult {
  const population = cases.filter((prepared) => prepared.touchesWindow)
  const cells = new Map<string, BreakdownCell>()
  const cellFor = (organizationId: string, group: string): BreakdownCell => {
    const key = JSON.stringify([organizationId, group])
    const existing = cells.get(key)
    if (existing) return existing
    const created: BreakdownCell = {
      organizationId,
      group,
      raw: 0,
      collapsed: 0,
      cases: new Set(),
      actors: new Set(),
      causes: emptyCauseCounts(),
      waits: [],
    }
    cells.set(key, created)
    return created
  }
  for (const prepared of population) {
    const organizationId = prepared.trace.organizationId
    const caseKey = `${organizationId}:${prepared.trace.caseId}`
    for (const event of prepared.filteredRaw) {
      if (!event.inWindow) continue
      for (const group of groupsOf(event, groupBy, organizationId)) {
        const cell = cellFor(organizationId, group)
        cell.raw += 1
        cell.cases.add(caseKey)
        if (event.actor) cell.actors.add(event.actor)
      }
    }
    const sequence = prepared.filteredCollapsed
    sequence.forEach((event, position) => {
      if (!event.inWindow) return
      const source = position > 0 ? sequence[position - 1] : null
      const measurable = source !== null && (context.includeSyncRun || (!source.sync && !event.sync))
      for (const group of groupsOf(event, groupBy, organizationId)) {
        const cell = cellFor(organizationId, group)
        cell.collapsed += 1
        cell.cases.add(caseKey)
        if (event.actor) cell.actors.add(event.actor)
        addCause(cell.causes, event)
        if (measurable && source) cell.waits.push(Math.max(0, event.atMs - source.atMs))
      }
    })
  }
  const tally = createSuppressionTally()
  const items: BreakdownResult['items'] = []
  for (const cell of cells.values()) {
    const personCell = groupBy === 'user' && cell.group !== XRAY_NONE_GROUP
    const reason = suppressionReason({ cases: cell.cases.size, actors: cell.actors.size }, context.k, { actorRule: !personCell })
    if (reason) {
      tally.record(reason)
      continue
    }
    items.push({
      organizationId: cell.organizationId,
      group: cell.group,
      raw: cell.raw,
      collapsed: cell.collapsed,
      cases: cell.cases.size,
      actors: cell.actors.size,
      causes: cell.causes,
      stepWait: summarizeDurations(cell.waits),
    })
  }
  items.sort((left, right) => left.organizationId.localeCompare(right.organizationId)
    || right.collapsed - left.collapsed
    || left.group.localeCompare(right.group))
  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    groupBy,
    perPerson: groupBy === 'user',
    overlapping: groupBy === 'role',
    includeSyncRun: context.includeSyncRun,
    items,
  }
}
