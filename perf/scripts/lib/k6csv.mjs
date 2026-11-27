import { createReadStream, existsSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { summarize } from './stats.mjs'

const UNMEASURED_STEPS = new Set(['warmup', 'none', 'setup', 'teardown'])

export function parseCsvLine(line) {
  const fields = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        current += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      fields.push(current)
      current = ''
    } else {
      current += character
    }
  }
  fields.push(current)
  return fields
}

export function parseExtraTags(value) {
  const tags = {}
  if (!value) return tags
  for (const pair of value.split('&')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    tags[decodeURIComponent(pair.slice(0, separator))] = decodeURIComponent(pair.slice(separator + 1))
  }
  return tags
}

export function rowFromFields(header, fields) {
  const record = {}
  header.forEach((column, index) => {
    record[column] = fields[index] ?? ''
  })
  const tags = {}
  for (const [column, value] of Object.entries(record)) {
    if (['metric_name', 'timestamp', 'metric_value', 'extra_tags', 'metadata'].includes(column)) continue
    if (value !== '') tags[column] = value
  }
  if (tags.group && tags.group.startsWith('::')) delete tags.group
  Object.assign(tags, parseExtraTags(record.extra_tags))
  return { metric: record.metric_name, timestamp: Number(record.timestamp), value: Number(record.metric_value), tags }
}

export function isMeasured(tags) {
  if (tags.measured === 'false') return false
  if (tags.step && UNMEASURED_STEPS.has(tags.step)) return false
  if (tags.phase === 'warmup' || tags.stage === 'warmup') return false
  return true
}

function bucket(map, key, create) {
  if (!map.has(key)) map.set(key, create())
  return map.get(key)
}

export function createAggregator() {
  const durations = new Map()
  const failures = new Map()
  const conflicts = new Map()
  const journeys = new Map()
  const vitals = new Map()
  const steps = new Map()
  const vusSamples = []
  const counters = { dropped: 0, checksPassed: 0, checksTotal: 0, excludedRows: 0 }

  function stepState(step) {
    return bucket(steps, step, () => ({ step, firstTs: Infinity, lastTs: -Infinity, holdFirstTs: Infinity, holdLastTs: -Infinity, requests: 0, holdRequests: 0, failed: 0, readDurations: [] }))
  }

  function addRequest(row, step) {
    const tags = row.tags
    const name = tags.name ?? tags.url ?? 'unnamed'
    const state = stepState(step)
    state.firstTs = Math.min(state.firstTs, row.timestamp)
    state.lastTs = Math.max(state.lastTs, row.timestamp)
    state.requests += 1
    if (tags.stage !== 'ramp') {
      state.holdRequests += 1
      state.holdFirstTs = Math.min(state.holdFirstTs, row.timestamp)
      state.holdLastTs = Math.max(state.holdLastTs, row.timestamp)
    }
    if (tags.group === 'read') state.readDurations.push(row.value)
    bucket(durations, `${name}\u0000${step}`, () => ({ name, group: tags.group ?? '', step, values: [] })).values.push(row.value)
  }

  function addFailure(row, step) {
    const name = row.tags.name ?? row.tags.url ?? 'unnamed'
    const entry = bucket(failures, `${name}\u0000${step}`, () => ({ failed: 0, total: 0 }))
    entry.total += 1
    entry.failed += row.value > 0 ? 1 : 0
    if (row.value > 0) stepState(step).failed += 1
  }

  function add(row) {
    if (row.metric === 'vus') {
      vusSamples.push([row.timestamp, row.value])
      return
    }
    if (row.metric === 'dropped_iterations') {
      counters.dropped += row.value
      return
    }
    if (!isMeasured(row.tags)) {
      counters.excludedRows += 1
      return
    }
    const step = row.tags.step ?? 'all'
    if (row.metric === 'http_req_duration') addRequest(row, step)
    else if (row.metric === 'http_req_failed') addFailure(row, step)
    else if (row.metric === 'om_conflicts') {
      const name = row.tags.name ?? 'unnamed'
      bucket(conflicts, `${name}\u0000${step}`, () => ({ count: 0 })).count += row.value
    } else if (row.metric === 'om_journey_duration') {
      bucket(journeys, row.tags.journey ?? 'unnamed', () => []).push(row.value)
    } else if (row.metric.startsWith('browser_web_vital_')) {
      bucket(vitals, row.metric.replace('browser_web_vital_', ''), () => []).push(row.value)
    } else if (row.metric === 'checks') {
      counters.checksTotal += 1
      counters.checksPassed += row.value > 0 ? 1 : 0
    }
  }

  function result() {
    return finalizeAggregation({ durations, failures, conflicts, journeys, vitals, steps, vusSamples, counters })
  }

  return { add, result }
}

function maxVusInWindow(vusSamples, firstTs, lastTs) {
  let maximum = 0
  let lastBefore = 0
  let lastBeforeTs = -Infinity
  for (const [timestamp, value] of vusSamples) {
    if (timestamp >= firstTs && timestamp <= lastTs && value > maximum) maximum = value
    if (timestamp < firstTs && timestamp > lastBeforeTs) {
      lastBefore = value
      lastBeforeTs = timestamp
    }
  }
  return maximum || lastBefore
}

function finalizeAggregation({ durations, failures, conflicts, journeys, vitals, steps, vusSamples, counters }) {
  const tagRows = [...durations.values()].map((entry) => {
    const key = `${entry.name}\u0000${entry.step}`
    const failure = failures.get(key) ?? { failed: 0, total: entry.values.length }
    const conflict = conflicts.get(key)?.count ?? 0
    return {
      name: entry.name,
      group: entry.group,
      step: entry.step,
      ...summarize(entry.values),
      errorRate: failure.total ? failure.failed / failure.total : 0,
      conflictRate: entry.values.length ? conflict / entry.values.length : 0,
    }
  })
  const stepRows = [...steps.values()].map((state) => {
    const holdSpan = state.holdLastTs > state.holdFirstTs ? state.holdLastTs - state.holdFirstTs : 0
    const span = state.lastTs > state.firstTs ? state.lastTs - state.firstTs : 0
    const usableSpan = holdSpan || span
    const usableRequests = holdSpan ? state.holdRequests : state.requests
    return {
      step: state.step,
      vus: maxVusInWindow(vusSamples, state.firstTs, state.lastTs),
      startedAt: Number.isFinite(state.firstTs) ? new Date(state.firstTs * 1000).toISOString() : null,
      finishedAt: Number.isFinite(state.lastTs) ? new Date(state.lastTs * 1000).toISOString() : null,
      startTs: state.firstTs,
      endTs: state.lastTs,
      requests: state.requests,
      throughput: usableSpan > 0 ? usableRequests / usableSpan : null,
      errorRate: state.requests ? state.failed / state.requests : 0,
      readP95: summarize(state.readDurations).p95,
    }
  }).sort(compareSteps)
  const journeyRows = [...journeys.entries()].map(([journey, values]) => ({ journey, ...summarize(values) }))
  const vitalRows = [...vitals.entries()].map(([vital, values]) => ({ vital, ...summarize(values) }))
  return {
    tags: tagRows,
    overallTags: mergeTagRowsAcrossSteps(tagRows, durations, failures, conflicts),
    steps: stepRows,
    journeys: journeyRows,
    webVitals: vitalRows,
    counters,
  }
}

function mergeTagRowsAcrossSteps(tagRows, durations, failures, conflicts) {
  const merged = new Map()
  for (const [key, entry] of durations) {
    const target = bucket(merged, entry.name, () => ({ name: entry.name, group: entry.group, values: [], failed: 0, total: 0, conflicts: 0 }))
    for (const value of entry.values) target.values.push(value)
    const failure = failures.get(key)
    target.failed += failure?.failed ?? 0
    target.total += failure?.total ?? entry.values.length
    target.conflicts += conflicts.get(key)?.count ?? 0
  }
  return [...merged.values()].map((entry) => ({
    name: entry.name,
    group: entry.group,
    step: 'all',
    ...summarize(entry.values),
    errorRate: entry.total ? entry.failed / entry.total : 0,
    conflictRate: entry.values.length ? entry.conflicts / entry.values.length : 0,
  })).sort((left, right) => left.name.localeCompare(right.name))
}

export function compareSteps(left, right) {
  const leftNumber = Number(left.step)
  const rightNumber = Number(right.step)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber
  if (Number.isFinite(left.startTs) && Number.isFinite(right.startTs)) return left.startTs - right.startTs
  return String(left.step).localeCompare(String(right.step))
}

export async function aggregateCsvFile(path) {
  if (!existsSync(path)) return null
  const source = createReadStream(path)
  const stream = path.endsWith('.gz') ? source.pipe(createGunzip()) : source
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const aggregator = createAggregator()
  let header = null
  for await (const line of lines) {
    if (!line) continue
    if (!header) {
      header = parseCsvLine(line)
      continue
    }
    aggregator.add(rowFromFields(header, parseCsvLine(line)))
  }
  return aggregator.result()
}

export function tagRowsFromSummary(summary) {
  const metrics = summary?.metrics ?? {}
  const rows = []
  for (const [metricName, metric] of Object.entries(metrics)) {
    const match = /^http_req_duration\{(.+)\}$/.exec(metricName)
    if (!match) continue
    const tags = Object.fromEntries(match[1].split(',').map((pair) => {
      const separator = pair.indexOf(':')
      return [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()]
    }))
    if (!tags.name) continue
    const values = metric.values ?? {}
    const failed = metrics[`http_req_failed{${match[1]}}`]?.values?.rate ?? null
    rows.push({
      name: tags.name,
      group: tags.group ?? '',
      step: tags.step ?? 'all',
      count: values.count ?? null,
      min: values.min ?? null,
      avg: values.avg ?? null,
      p50: values.med ?? values['p(50)'] ?? null,
      p95: values['p(95)'] ?? null,
      p99: values['p(99)'] ?? null,
      max: values.max ?? null,
      errorRate: failed,
      conflictRate: null,
    })
  }
  return rows
}
