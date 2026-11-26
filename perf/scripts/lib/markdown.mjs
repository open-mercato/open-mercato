export function escapeCell(value) {
  if (value === null || value === undefined || value === '') return '–'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function markdownTable(headers, rows) {
  if (!rows.length) return '_No data._\n'
  const head = `| ${headers.map(escapeCell).join(' | ')} |`
  const divider = `|${headers.map(() => '---').join('|')}|`
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`)
  return [head, divider, ...body].join('\n').concat('\n')
}

export function formatMs(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  if (value >= 10000) return `${(value / 1000).toFixed(1)} s`
  if (value >= 100) return `${Math.round(value)}`
  return value.toFixed(1)
}

export function formatPct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return `${(value * 100).toFixed(digits)}%`
}

export function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}

export function formatBytes(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

export function formatUnit(value, unit) {
  if (value === null || value === undefined) return null
  if (unit === 'bytes') return formatBytes(value)
  if (unit === 'ratio') return formatPct(value, 1)
  if (unit === 'seconds') return formatMs(value * 1000) === null ? null : `${formatMs(value * 1000)} ms`
  if (unit === 'cores') return value.toFixed(2)
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function referenceMark(p95, referenceMs) {
  if (p95 === null || p95 === undefined || !referenceMs) return ''
  return p95 > referenceMs ? 'over ref' : ''
}

export function tagTableRows(tagRows, { readP95Ms } = {}) {
  return tagRows.map((row) => [
    row.name,
    row.group,
    row.step,
    row.count,
    formatMs(row.p50),
    formatMs(row.p95),
    formatMs(row.p99),
    formatMs(row.max),
    formatPct(row.errorRate),
    formatPct(row.conflictRate),
    row.group === 'read' ? referenceMark(row.p95, readP95Ms) : '',
  ])
}

export const TAG_TABLE_HEADERS = ['Tag', 'Group', 'Step', 'Count', 'p50 ms', 'p95 ms', 'p99 ms', 'Max ms', 'Errors', 'Conflicts', 'Ref']

export function stepTableRows(steps) {
  return steps.map((step) => [
    step.step,
    step.vus,
    step.requests,
    step.throughput === null ? null : step.throughput.toFixed(1),
    formatMs(step.readP95),
    formatPct(step.errorRate),
    step.startedAt,
  ])
}

export const STEP_TABLE_HEADERS = ['Step', 'VUs', 'Requests', 'Req/s', 'Read p95 ms', 'Errors', 'Started']

export function resourceTableRows(resources) {
  const rows = []
  for (const metric of resources?.metrics ?? []) {
    for (const row of metric.rows) {
      if (row.samples === 0) continue
      rows.push([metric.label, row.label, row.window, formatUnit(row.avg, metric.unit), formatUnit(row.max, metric.unit)])
    }
  }
  return rows
}

export const RESOURCE_TABLE_HEADERS = ['Metric', 'Series', 'Window', 'Avg', 'Peak']

export function statementRows(statements) {
  return statements.map((statement) => [
    statement.queryid,
    statement.calls,
    formatMs(statement.total_exec_time),
    formatMs(statement.mean_exec_time),
    statement.rows,
    statement.callsPerRequest === undefined || statement.callsPerRequest === null ? null : statement.callsPerRequest.toFixed(2),
    `\`${String(statement.query ?? '').replace(/\s+/g, ' ').slice(0, 160)}\``,
  ])
}

export const STATEMENT_TABLE_HEADERS = ['queryid', 'Calls', 'Total ms', 'Mean ms', 'Rows', 'Calls/req', 'Statement']
