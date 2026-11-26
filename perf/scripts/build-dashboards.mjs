#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'monitoring', 'grafana', 'dashboards')
const datasource = { type: 'prometheus', uid: 'prometheus' }
const project = 'container_label_com_docker_compose_project="om-perf"'
const serviceLabel = 'container_label_com_docker_compose_service'

function target(expr, legendFormat, refId) {
  return { datasource, expr, legendFormat, refId, range: true }
}

function panel({ title, unit = 'short', targets, gridPos, kind = 'timeseries', description }) {
  return {
    type: kind,
    title,
    description,
    datasource,
    gridPos,
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: kind === 'timeseries'
      ? { legend: { displayMode: 'table', placement: 'bottom', calcs: ['mean', 'max'] }, tooltip: { mode: 'multi' } }
      : { reduceOptions: { calcs: ['lastNotNull'] } },
    targets: targets.map((entry, index) => target(entry[0], entry[1], String.fromCharCode(65 + index))),
  }
}

function layout(panels) {
  const width = 12
  const height = 8
  return panels.map((definition, index) => panel({
    ...definition,
    gridPos: { x: (index % 2) * width, y: Math.floor(index / 2) * height, w: width, h: height },
  }))
}

function dashboard({ uid, title, tags, panels, variables = [] }) {
  return {
    uid,
    title,
    tags: ['om-perf', ...tags],
    editable: false,
    schemaVersion: 39,
    version: 1,
    refresh: '10s',
    time: { from: 'now-1h', to: 'now' },
    timezone: 'utc',
    templating: { list: variables },
    panels: layout(panels),
  }
}

function queryVariable(name, query, includeAll = true) {
  return {
    name,
    type: 'query',
    datasource,
    query: { query, refId: name },
    definition: query,
    includeAll,
    multi: true,
    current: includeAll ? { text: 'All', value: '$__all' } : {},
    refresh: 2,
  }
}

const k6 = dashboard({
  uid: 'om-perf-k6',
  title: 'k6 load',
  tags: ['k6'],
  variables: [queryVariable('run_id', 'label_values(k6_vus, run_id)', false), queryVariable('name', 'label_values(k6_http_req_duration_p95{run_id=~"$run_id"}, name)')],
  panels: [
    { title: 'Virtual users', targets: [['sum(k6_vus{run_id=~"$run_id"})', 'vus']] },
    { title: 'Request rate', unit: 'reqps', targets: [['sum(rate(k6_http_reqs_total{run_id=~"$run_id"}[1m]))', 'req/s']] },
    { title: 'p95 by endpoint tag', unit: 's', targets: [['max by (name) (k6_http_req_duration_p95{run_id=~"$run_id", name=~"$name"})', '{{name}}']] },
    { title: 'p99 by group', unit: 's', targets: [['max by (group) (k6_http_req_duration_p99{run_id=~"$run_id"})', '{{group}}']] },
    { title: 'Error rate', unit: 'percentunit', targets: [['sum(rate(k6_http_reqs_total{run_id=~"$run_id", expected_response="false"}[1m])) / sum(rate(k6_http_reqs_total{run_id=~"$run_id"}[1m]))', 'errors']] },
    { title: 'Optimistic-lock conflicts', unit: 'short', targets: [['sum(rate(k6_om_conflicts_total{run_id=~"$run_id"}[1m])) * 60', 'per min']] },
    { title: 'Journey duration p95', unit: 's', targets: [['max by (journey) (k6_om_journey_duration_p95{run_id=~"$run_id"})', '{{journey}}']] },
    { title: 'Dropped iterations (generator saturation)', targets: [['sum(rate(k6_dropped_iterations_total{run_id=~"$run_id"}[1m])) * 60', 'per min']] },
    { title: 'Web Vitals p95 (LCP, FCP, TTFB, INP)', unit: 'ms', targets: ['lcp', 'fcp', 'ttfb', 'inp'].map((vital) => [`max(k6_browser_web_vital_${vital}_p95{run_id=~"$run_id"})`, vital]) },
    { title: 'Web Vital CLS p95', unit: 'short', targets: [['max(k6_browser_web_vital_cls_p95{run_id=~"$run_id"})', 'cls']] },
  ],
})

const node = dashboard({
  uid: 'om-perf-node',
  title: 'Host (node-exporter)',
  tags: ['host'],
  panels: [
    { title: 'CPU busy by mode', unit: 'percentunit', targets: [['sum by (mode) (rate(node_cpu_seconds_total{mode!="idle"}[1m])) / scalar(count(node_cpu_seconds_total{mode="idle"}))', '{{mode}}']] },
    { title: 'CPU steal', unit: 'percentunit', targets: [['avg(rate(node_cpu_seconds_total{mode="steal"}[1m]))', 'steal']] },
    { title: 'Load average', targets: [['node_load1', 'load1'], ['node_load5', 'load5'], ['count(node_cpu_seconds_total{mode="idle"})', 'cpus']] },
    { title: 'Memory', unit: 'bytes', targets: [['node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes', 'used'], ['node_memory_MemTotal_bytes', 'total']] },
    { title: 'Disk IO busy', unit: 'percentunit', targets: [['max by (device) (rate(node_disk_io_time_seconds_total[1m]))', '{{device}}']] },
    { title: 'Disk throughput', unit: 'Bps', targets: [['sum(rate(node_disk_read_bytes_total[1m]))', 'read'], ['sum(rate(node_disk_written_bytes_total[1m]))', 'write']] },
    { title: 'Network', unit: 'Bps', targets: [['sum(rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[1m]))', 'rx'], ['sum(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[1m]))', 'tx']] },
    { title: 'Filesystem free', unit: 'percentunit', targets: [['min by (mountpoint) (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"})', '{{mountpoint}}']] },
  ],
})

const containers = dashboard({
  uid: 'om-perf-containers',
  title: 'Containers (cAdvisor)',
  tags: ['containers'],
  panels: [
    { title: 'CPU cores by service', targets: [[`sum by (${serviceLabel}) (rate(container_cpu_usage_seconds_total{${project}}[1m]))`, `{{${serviceLabel}}}`]] },
    { title: 'Working set memory by service', unit: 'bytes', targets: [[`sum by (${serviceLabel}) (container_memory_working_set_bytes{${project}})`, `{{${serviceLabel}}}`]] },
    { title: 'CPU throttling', unit: 'percentunit', targets: [[`sum by (${serviceLabel}) (rate(container_cpu_cfs_throttled_periods_total{${project}}[1m])) / sum by (${serviceLabel}) (rate(container_cpu_cfs_periods_total{${project}}[1m]))`, `{{${serviceLabel}}}`]] },
    { title: 'Network rx by service', unit: 'Bps', targets: [[`sum by (${serviceLabel}) (rate(container_network_receive_bytes_total{${project}}[1m]))`, `{{${serviceLabel}}}`]] },
    { title: 'Block IO by service', unit: 'Bps', targets: [[`sum by (${serviceLabel}) (rate(container_fs_writes_bytes_total{${project}}[1m]) + rate(container_fs_reads_bytes_total{${project}}[1m]))`, `{{${serviceLabel}}}`]] },
    { title: 'OOM events', targets: [[`sum by (${serviceLabel}) (increase(container_oom_events_total{${project}}[5m]))`, `{{${serviceLabel}}}`]] },
  ],
})

const postgres = dashboard({
  uid: 'om-perf-postgres',
  title: 'PostgreSQL',
  tags: ['postgres'],
  panels: [
    { title: 'Backends by database', targets: [['sum by (datname) (pg_stat_database_numbackends)', '{{datname}}'], ['max(pg_settings_max_connections)', 'max_connections']] },
    { title: 'Transactions per second', unit: 'ops', targets: [['sum by (datname) (rate(pg_stat_database_xact_commit[1m]) + rate(pg_stat_database_xact_rollback[1m]))', '{{datname}}']] },
    { title: 'Buffer cache hit ratio', unit: 'percentunit', targets: [['sum by (datname) (rate(pg_stat_database_blks_hit[1m])) / (sum by (datname) (rate(pg_stat_database_blks_hit[1m])) + sum by (datname) (rate(pg_stat_database_blks_read[1m])))', '{{datname}}']] },
    { title: 'Rows fetched / returned', unit: 'ops', targets: [['sum(rate(pg_stat_database_tup_fetched[1m]))', 'fetched'], ['sum(rate(pg_stat_database_tup_returned[1m]))', 'returned']] },
    { title: 'Locks by mode', targets: [['sum by (mode) (pg_locks_count)', '{{mode}}']] },
    { title: 'Temp bytes', unit: 'Bps', targets: [['sum(rate(pg_stat_database_temp_bytes[1m]))', 'temp']] },
    { title: 'Deadlocks', targets: [['sum(increase(pg_stat_database_deadlocks[5m]))', 'deadlocks']] },
    { title: 'Longest running transaction', unit: 's', targets: [['max(pg_long_running_transactions_oldest_timestamp_seconds)', 'oldest']] },
    { title: 'Top statements by exec time', unit: 's', targets: [['topk(10, rate(pg_stat_statements_seconds_total[1m]))', '{{queryid}}']] },
    { title: 'Database size', unit: 'bytes', targets: [['pg_database_size_bytes', '{{datname}}']] },
  ],
})

const redis = dashboard({
  uid: 'om-perf-redis',
  title: 'Redis and BullMQ',
  tags: ['redis'],
  panels: [
    { title: 'Memory used vs maxmemory', unit: 'bytes', targets: [['redis_memory_used_bytes', 'used'], ['redis_memory_max_bytes', 'max']] },
    { title: 'Commands per second', unit: 'ops', targets: [['sum(rate(redis_commands_processed_total[1m]))', 'commands']] },
    { title: 'Connected clients', targets: [['redis_connected_clients', 'clients']] },
    { title: 'Keyspace hit ratio', unit: 'percentunit', targets: [['rate(redis_keyspace_hits_total[1m]) / (rate(redis_keyspace_hits_total[1m]) + rate(redis_keyspace_misses_total[1m]))', 'hit ratio']] },
    { title: 'BullMQ waiting + delayed by queue', targets: [['sum by (key) (redis_key_size{key=~"bull:.*:(wait|delayed|prioritized|paused)"})', '{{key}}']] },
    { title: 'BullMQ active by queue', targets: [['sum by (key) (redis_key_size{key=~"bull:.*:active"})', '{{key}}']] },
    { title: 'BullMQ failed by queue', targets: [['sum by (key) (redis_key_size{key=~"bull:.*:failed"})', '{{key}}']] },
    { title: 'Rejected connections / evictions', targets: [['rate(redis_rejected_connections_total[1m])', 'rejected'], ['rate(redis_evicted_keys_total[1m])', 'evicted']] },
  ],
})

const runtime = dashboard({
  uid: 'om-perf-runtime',
  title: 'OM runtime',
  tags: ['app'],
  panels: [
    { title: 'DB pool connections (used / idle / max)', targets: [['sum by (job, state) ({__name__=~"om_db_pool_connections.*"})', '{{job}} {{state}}'], ['max by (job) ({__name__=~"om_db_pool_max.*"})', '{{job}} max']] },
    { title: 'DB pool pending acquires', targets: [['sum by (job) ({__name__=~"om_db_pool_pending_requests.*"})', '{{job}}']] },
    { title: 'DB pool wait p95', unit: 's', targets: [['histogram_quantile(0.95, sum by (le, job) (rate({__name__=~"om_db_pool_wait_time.*_bucket"}[1m])))', '{{job}}']] },
    { title: 'Event loop utilization', unit: 'percentunit', targets: [['max by (job) ({__name__=~"nodejs_eventloop_utilization.*"})', '{{job}}']] },
    { title: 'Event loop delay p99', unit: 's', targets: [['max by (job) ({__name__=~"nodejs_eventloop_delay_p99.*"})', '{{job}}']] },
    { title: 'V8 heap used', unit: 'bytes', targets: [['sum by (job) ({__name__=~"v8js_memory_heap_used.*"})', '{{job}}']] },
    { title: 'Process memory', unit: 'bytes', targets: [['max by (job) ({__name__=~"process_memory_usage.*"})', '{{job}}']] },
    { title: 'BullMQ backlog (all queues)', targets: [['sum(redis_key_size{key=~"bull:.*:(wait|delayed|prioritized)"})', 'waiting'], ['sum(redis_key_size{key=~"bull:.*:active"})', 'active']] },
    { title: 'Server-side request duration p95 (Caddy)', unit: 's', targets: [['histogram_quantile(0.95, sum by (le) (rate(caddy_http_request_duration_seconds_bucket[1m])))', 'p95']] },
    { title: 'Server-side request rate by status (Caddy)', unit: 'reqps', targets: [['sum by (code) (rate(caddy_http_request_duration_seconds_count[1m]))', '{{code}}']] },
  ],
})

mkdirSync(outputDir, { recursive: true })
for (const entry of [k6, node, containers, postgres, redis, runtime]) {
  writeFileSync(join(outputDir, `${entry.uid}.json`), `${JSON.stringify(entry, null, 2)}\n`)
}
process.stdout.write(`wrote 6 dashboards to ${outputDir}\n`)
