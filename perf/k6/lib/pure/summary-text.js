function formatNumber(value, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  return value.toFixed(digits)
}

function trendLine(name, values) {
  const unit = /cls/i.test(name) ? '' : 'ms'
  const digits = unit ? undefined : 3
  return `${name}: p50=${formatNumber(values.med, digits)}${unit} p95=${formatNumber(values['p(95)'], digits)}${unit} p99=${formatNumber(values['p(99)'], digits)}${unit} max=${formatNumber(values.max, digits)}${unit} n=${values.count ?? '-'}`
}

function metricLine(name, metric) {
  const values = metric.values ?? {}
  if (metric.type === 'trend') return trendLine(name, values)
  if (metric.type === 'rate') return `${name}: ${formatNumber((values.rate ?? 0) * 100, 2)}% (${values.passes ?? 0}/${(values.passes ?? 0) + (values.fails ?? 0)})`
  if (metric.type === 'counter') return `${name}: ${values.count ?? 0} (${formatNumber(values.rate ?? 0, 2)}/s)`
  if (metric.type === 'gauge') return `${name}: ${values.value ?? '-'}`
  return `${name}: ${JSON.stringify(values)}`
}

const HEADLINE_METRICS = [
  'http_reqs',
  'http_req_failed',
  'http_req_duration',
  'checks',
  'om_conflicts',
  'om_journey_duration',
  'om_bulk_job_duration',
  'iterations',
  'dropped_iterations',
  'vus_max',
  'browser_web_vital_lcp',
  'browser_web_vital_inp',
  'browser_web_vital_cls',
]

function failedThresholds(metrics) {
  const failed = []
  for (const name of Object.keys(metrics)) {
    const thresholds = metrics[name].thresholds ?? {}
    for (const expression of Object.keys(thresholds)) {
      if (thresholds[expression] && thresholds[expression].ok === false) failed.push(`${name} ${expression}`)
    }
  }
  return failed
}

function failedChecks(group, prefix = '') {
  const result = []
  if (!group) return result
  for (const item of group.checks ?? []) {
    if (item.fails > 0) result.push(`${prefix}${item.name}: ${item.fails} failed / ${item.passes} passed`)
  }
  for (const child of group.groups ?? []) result.push(...failedChecks(child, `${prefix}${child.name} > `))
  return result
}

export function evaluateReference(metrics, reference) {
  const lines = []
  const readMetric = metrics['http_req_duration{group:read,measured:1}'] ?? metrics['http_req_duration{group:read}']
  if (readMetric && reference && typeof reference.readP95Ms === 'number') {
    const p95 = readMetric.values['p(95)']
    lines.push({ name: 'read p95', value: p95, limit: reference.readP95Ms, ok: typeof p95 === 'number' && p95 < reference.readP95Ms })
  }
  const failedMetric = metrics['http_req_failed{measured:1}'] ?? metrics.http_req_failed
  if (failedMetric && reference && typeof reference.errorRate === 'number') {
    const rate = failedMetric.values.rate
    lines.push({ name: 'error rate', value: rate, limit: reference.errorRate, ok: typeof rate === 'number' && rate < reference.errorRate })
  }
  return lines
}

export function renderTextSummary(data, { title = 'k6 run', reference } = {}) {
  const metrics = (data && data.metrics) || {}
  const lines = [`== ${title} ==`]
  const durationMs = data && data.state ? data.state.testRunDurationMs : undefined
  if (typeof durationMs === 'number') lines.push(`duration: ${formatNumber(durationMs / 1000, 0)}s`)
  for (const name of HEADLINE_METRICS) {
    if (metrics[name]) lines.push(metricLine(name, metrics[name]))
  }
  const groupMetrics = Object.keys(metrics).filter((name) => name.startsWith('http_req_duration{group:')).sort()
  if (groupMetrics.length) {
    lines.push('-- by group --')
    for (const name of groupMetrics) {
      if ((metrics[name].values ?? {}).count === 0) continue
      lines.push(metricLine(name, metrics[name]))
    }
  }
  const referenceLines = evaluateReference(metrics, reference)
  if (referenceLines.length) {
    lines.push('-- reference lines (informational, never fail the run) --')
    for (const line of referenceLines) {
      lines.push(`${line.ok ? 'ok  ' : 'over'} ${line.name}: ${formatNumber(line.value, 3)} (reference ${line.limit})`)
    }
  }
  const thresholds = failedThresholds(metrics)
  if (thresholds.length) {
    lines.push('-- failed thresholds --')
    lines.push(...thresholds)
  }
  const checks = failedChecks(data && data.root_group)
  if (checks.length) {
    lines.push('-- failed checks --')
    lines.push(...checks.slice(0, 40))
    if (checks.length > 40) lines.push(`... ${checks.length - 40} more`)
  }
  return `${lines.join('\n')}\n`
}
