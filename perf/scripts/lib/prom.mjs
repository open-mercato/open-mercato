const SERVICE = 'container_label_com_docker_compose_service'
const PROJECT = 'container_label_com_docker_compose_project="om-perf"'

export const RESOURCE_QUERIES = [
  { id: 'cpu', label: 'CPU cores', unit: 'cores', by: SERVICE, expr: `sum by (${SERVICE}) (rate(container_cpu_usage_seconds_total{${PROJECT}}[1m]))` },
  { id: 'memory', label: 'Working set', unit: 'bytes', by: SERVICE, expr: `sum by (${SERVICE}) (container_memory_working_set_bytes{${PROJECT}})` },
  { id: 'poolUsed', label: 'DB pool used', unit: 'count', by: 'job', expr: 'sum by (job) ({__name__=~"om_db_pool_connections.*", state="used"})' },
  { id: 'poolPending', label: 'DB pool pending', unit: 'count', by: 'job', expr: 'sum by (job) ({__name__=~"om_db_pool_pending_requests.*"})' },
  { id: 'poolWaitP95', label: 'DB pool wait p95', unit: 'seconds', by: 'job', expr: 'histogram_quantile(0.95, sum by (le, job) (rate({__name__=~"om_db_pool_wait_time.*_bucket"}[1m])))' },
  { id: 'eventLoop', label: 'Event loop utilization', unit: 'ratio', by: 'job', expr: 'max by (job) ({__name__=~"nodejs_eventloop_utilization.*"})' },
  { id: 'eventLoopDelayP99', label: 'Event loop delay p99', unit: 'seconds', by: 'job', expr: 'max by (job) ({__name__=~"nodejs_eventloop_delay_p99.*"})' },
  { id: 'heap', label: 'V8 heap used', unit: 'bytes', by: 'job', expr: 'sum by (job) ({__name__=~"v8js_memory_heap_used.*"})' },
  { id: 'queueDepth', label: 'BullMQ waiting', unit: 'count', by: null, expr: 'sum(redis_key_size{key=~"bull:.*:(wait|delayed|prioritized|paused)"})' },
  { id: 'queueActive', label: 'BullMQ active', unit: 'count', by: null, expr: 'sum(redis_key_size{key=~"bull:.*:active"})' },
  { id: 'redisMemory', label: 'Redis memory', unit: 'bytes', by: null, expr: 'max(redis_memory_used_bytes)' },
  { id: 'pgBackends', label: 'Postgres backends', unit: 'count', by: null, expr: 'sum(pg_stat_database_numbackends)' },
  { id: 'pgCacheHit', label: 'Postgres cache hit', unit: 'ratio', by: null, expr: 'sum(rate(pg_stat_database_blks_hit[1m])) / (sum(rate(pg_stat_database_blks_hit[1m])) + sum(rate(pg_stat_database_blks_read[1m])))' },
  { id: 'diskBusy', label: 'Disk busy', unit: 'ratio', by: null, expr: 'max(rate(node_disk_io_time_seconds_total[1m]))' },
  { id: 'steal', label: 'CPU steal', unit: 'ratio', by: null, expr: 'avg(rate(node_cpu_seconds_total{mode="steal"}[1m]))' },
  { id: 'serverP95', label: 'Server-side p95 (Caddy)', unit: 'seconds', by: null, expr: 'histogram_quantile(0.95, sum by (le) (rate(caddy_http_request_duration_seconds_bucket[1m])))' },
]

export async function queryRange(baseUrl, expr, startSec, endSec, stepSec = 15) {
  const params = new URLSearchParams({ query: expr, start: String(startSec), end: String(endSec), step: String(stepSec) })
  const response = await fetch(`${baseUrl}/api/v1/query_range?${params}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`[perf] prometheus HTTP ${response.status} for ${expr}`)
  const payload = await response.json()
  if (payload.status !== 'success') throw new Error(`[perf] prometheus error ${payload.error ?? 'unknown'}`)
  return payload.data.result.map((series) => ({
    metric: series.metric,
    values: series.values.map(([timestamp, value]) => [Number(timestamp), Number(value)]).filter(([, value]) => Number.isFinite(value)),
  }))
}

export function windowStats(values, fromSec, toSec) {
  let total = 0
  let count = 0
  let maximum = null
  for (const [timestamp, value] of values) {
    if (timestamp < fromSec || timestamp > toSec) continue
    total += value
    count += 1
    maximum = maximum === null ? value : Math.max(maximum, value)
  }
  return { avg: count ? total / count : null, max: maximum, samples: count }
}

export function seriesLabel(series, by) {
  if (!by) return 'total'
  return series.metric[by] ?? 'unknown'
}

export function summarizeSeriesByWindow(seriesList, by, windows) {
  const rows = []
  for (const series of seriesList) {
    const label = seriesLabel(series, by)
    for (const window of windows) {
      rows.push({ label, window: window.name, ...windowStats(series.values, window.from, window.to) })
    }
  }
  return rows
}

export async function collectResources(baseUrl, windows, queries = RESOURCE_QUERIES) {
  if (!windows.length) return { available: false, error: 'no time windows', metrics: [] }
  const startSec = Math.min(...windows.map((window) => window.from))
  const endSec = Math.max(...windows.map((window) => window.to))
  const metrics = []
  const errors = []
  for (const query of queries) {
    try {
      const series = await queryRange(baseUrl, query.expr, Math.floor(startSec), Math.ceil(endSec))
      metrics.push({ id: query.id, label: query.label, unit: query.unit, rows: summarizeSeriesByWindow(series, query.by, windows) })
    } catch (error) {
      errors.push(`${query.id}: ${error.message}`)
    }
  }
  return { available: metrics.length > 0, errors, metrics }
}
