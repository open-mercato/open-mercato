export function experimentTotals(experiment) {
  return experiment.lanes.reduce(
    (total, lane) => ({
      total: total.total + lane.total,
      completed: total.completed + lane.completed,
      passed: total.passed + (lane.counts.pass || 0),
      failed: total.failed + (lane.counts.fail || 0) + (lane.counts.error || 0),
      blocked: total.blocked + (lane.counts.blocked || 0),
      skipped: total.skipped + (lane.counts.skipped || 0),
      observed: total.observed || lane.totalSource === 'observed',
    }),
    {
      total: 0,
      completed: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      observed: false,
    },
  )
}

export function filterCases(
  cases,
  { query = '', laneId = null, status = null, group = null },
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return cases.filter((record) => {
    const laneOutcome =
      laneId && Object.hasOwn(record.lanes, laneId)
        ? record.lanes[laneId]
        : null
    const outcomes = laneId
      ? laneOutcome
        ? [laneOutcome]
        : []
      : Object.values(record.lanes)
    if (laneId && (!laneOutcome || laneOutcome.status === 'not-applicable'))
      return false
    if (group && record.group !== group) return false
    if (status && !outcomes.some((outcome) => outcome.status === status))
      return false
    return (
      !normalizedQuery ||
      [
        record.id,
        record.title,
        record.group,
        ...outcomes.flatMap((outcome) => outcome.diagnostics),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  })
}

export function metricPresentation(metrics, now = Date.now()) {
  if (!metrics || metrics.availability !== 'reported')
    return { kind: 'not-reported', rate: null, stale: false }
  const kind = metrics.measurementKind || 'experiment'
  const sampled = metrics.sampledAt ? Date.parse(metrics.sampledAt) : null
  const stale =
    kind === 'live' &&
    (metrics.stale === true || (sampled !== null && now - sampled > 30000))
  const rate = stale
    ? null
    : (metrics.outputTokensPerSecond ?? metrics.tokensPerSecond ?? null)
  return { kind, rate, stale }
}

export function selectMetrics(experiment) {
  const live = experiment.active.find(
    (activity) =>
      activity.metrics?.availability === 'reported' &&
      activity.metrics.measurementKind === 'live',
  )
  return live
    ? { metrics: live.metrics, caseId: live.caseId }
    : { metrics: experiment.metrics, caseId: null }
}
