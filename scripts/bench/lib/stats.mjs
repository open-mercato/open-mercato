// Pure summaries and the Markdown comparison report (unit-tested in scripts/__tests__).

export function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

export function summarizeLatencies(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b)
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), mean }
}

/** Per-request cost from pg_stat_statements rows collected over `requests` sequential requests. */
export function summarizeStatements(statements, requests) {
  const totalCalls = statements.reduce((acc, s) => acc + Number(s.calls), 0)
  const totalSqlMs = statements.reduce((acc, s) => acc + Number(s.total_exec_time), 0)
  return {
    queriesPerRequest: totalCalls / requests,
    sqlMsPerRequest: totalSqlMs / requests,
    distinctStatements: statements.length,
    statements: statements.map((s) => ({ ...s, callsPerRequest: Number(s.calls) / requests })),
  }
}

const fmt = (value, digits = 1) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits))

/**
 * Markdown table comparing request-cost reports scenario by scenario. The first report is the
 * baseline; later ones show the change in queries per request next to their own numbers.
 */
export function renderComparison(reports) {
  if (!reports.length) return 'No reports found.\n'
  const scenarioNames = [...new Set(reports.flatMap((r) => Object.keys(r.scenarios ?? {})))]
  const lines = [
    '| Scenario | Report | Queries / req | SQL ms / req | p50 ms | p95 ms | Distinct statements | Statuses |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const name of scenarioNames) {
    const base = reports[0].scenarios?.[name]
    for (const report of reports) {
      const s = report.scenarios?.[name]
      if (!s) continue
      const delta = base && report !== reports[0] && base.queriesPerRequest
        ? ` (${s.queriesPerRequest >= base.queriesPerRequest ? '+' : ''}${fmt(((s.queriesPerRequest / base.queriesPerRequest) - 1) * 100, 0)}%)`
        : ''
      lines.push(`| ${name} | ${report.label} | ${fmt(s.queriesPerRequest, 2)}${delta} | ${fmt(s.sqlMsPerRequest, 2)} | ${fmt(s.latencyMs?.p50)} | ${fmt(s.latencyMs?.p95)} | ${s.distinctStatements ?? '—'} | ${Object.entries(s.statuses ?? {}).map(([k, v]) => `${k}×${v}`).join(' ')} |`)
    }
  }
  return `${lines.join('\n')}\n`
}
