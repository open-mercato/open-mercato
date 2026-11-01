import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

export const OUTCOME_STATUSES = ['pending', 'running', 'pass', 'fail', 'blocked', 'error', 'skipped', 'not-applicable']
const RUN_STATUSES = [...OUTCOME_STATUSES, 'completed', 'stopped', 'unknown']
const TERMINAL = new Set(['pass', 'fail', 'blocked', 'error', 'skipped'])
export const MAX_JSON_BYTES = 4 * 1024 * 1024
export const MAX_TEXT_BYTES = 512 * 1024
export const MAX_CASES = 10000
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function cleanText(value, maxLength = 20000) {
  return String(value ?? '')
    .replaceAll(os.homedir(), '<home>')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[psou]_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/(\bauthorization\s*[:=]\s*["']?bearer\s+)[A-Za-z0-9._~+/-]{16,}/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    .slice(0, maxLength)
}
export function identifier(value, label = 'identifier') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid ${label}`)
  return value
}
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`)
}
function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}
export function registrationId(root) {
  return 'run-' + crypto.createHash('sha256').update(root).digest('hex').slice(0, 16)
}
export function normalizeMetrics(value) {
  const metrics = { availability: 'not-reported' }
  if (!isRecord(value)) return metrics
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'tokensPerSecond', 'outputTokensPerSecond', 'windowSeconds', 'generationSeconds']) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) throw new Error('Invalid producer token metric')
    metrics[key] = value[key]
    metrics.availability = 'reported'
  }
  if (timestamp(value.sampledAt)) { metrics.sampledAt = timestamp(value.sampledAt); metrics.stale = Date.now() - Date.parse(metrics.sampledAt) > 30000 }
  if (value.measurementKind !== undefined) {
    if (!['live', 'completed-response', 'experiment'].includes(value.measurementKind)) throw new Error('Invalid token metric measurement kind')
    metrics.measurementKind = value.measurementKind
  }
  if (metrics.outputTokensPerSecond === undefined && metrics.outputTokens > 0 && metrics.generationSeconds > 0) {
    metrics.outputTokensPerSecond = metrics.outputTokens / metrics.generationSeconds
    metrics.rateSource = 'counter-generation-time'
  } else if (metrics.tokensPerSecond !== undefined || metrics.outputTokensPerSecond !== undefined) metrics.rateSource = 'producer'
  if (typeof value.rateSource === 'string' && metrics.availability === 'reported') metrics.rateSource = cleanText(value.rateSource, 200)
  return metrics
}
export function normalizeOutcome(value) {
  if (!isRecord(value) || !OUTCOME_STATUSES.includes(value.status)) throw new Error('Invalid outcome status')
  const diagnostics = value.diagnostics ?? value.violations ?? (value.reason ? [value.reason] : value.sanitizedError ? [value.sanitizedError] : [])
  if (!Array.isArray(diagnostics)) throw new Error('Invalid outcome diagnostics')
  const outcome = { status: value.status, metrics: normalizeMetrics(value.metrics), diagnostics: diagnostics.slice(0, 200).map(item => cleanText(item, 4096)) }
  for (const key of ['attempts', 'corrections', 'durationMs']) {
    if (value[key] !== undefined) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid ${key}`)
      outcome[key] = value[key]
    }
  }
  if (Array.isArray(value.artifactIds)) outcome.artifactIds = value.artifactIds.slice(0, 100).map(value => cleanText(value, 200))
  return outcome
}
export function normalizeExperiment(raw, { root, source = 'generic', mtime, now = Date.now() }) {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.lanes) || !Array.isArray(raw.cases)) throw new Error('Invalid experiment snapshot')
  if (raw.cases.length > MAX_CASES || raw.lanes.length > 64) throw new Error('Experiment exceeds case or lane limits')
  const producerId = identifier(raw.id, 'experiment id')
  const laneIds = raw.lanes.map(lane => identifier(lane?.id, 'lane id'))
  unique(laneIds, 'lane id')
  const cases = raw.cases.map(record => {
    if (!isRecord(record) || !isRecord(record.lanes)) throw new Error('Invalid case record')
    const id = identifier(record.id, 'case id')
    const lanes = Object.fromEntries(Object.entries(record.lanes).map(([laneId, outcome]) => {
      if (!laneIds.includes(laneId)) throw new Error('Case references an undeclared lane')
      return [laneId, normalizeOutcome(outcome)]
    }))
    return { id, title: cleanText(record.title || id, 1000), group: cleanText(record.group || record.family || '', 200), ...(typeof record.prompt === 'string' ? { prompt: cleanText(record.prompt) } : {}), lanes }
  })
  unique(cases.map(record => record.id), 'case id')
  const lanes = raw.lanes.map(lane => {
    if (lane.total !== undefined && (!Number.isSafeInteger(lane.total) || lane.total < 0 || lane.total > 1000000)) throw new Error('Invalid lane total')
    const outcomes = cases.filter(record => Object.hasOwn(record.lanes, lane.id)).map(record => record.lanes[lane.id]).filter(outcome => outcome.status !== 'not-applicable')
    const counts = Object.fromEntries(OUTCOME_STATUSES.map(status => [status, outcomes.filter(outcome => outcome.status === status).length]))
    return { id: lane.id, label: cleanText(lane.label || lane.id, 200), total: Math.max(lane.total ?? 0, outcomes.length), totalSource: lane.total === undefined ? 'observed' : 'declared', observedTotal: outcomes.length, completed: outcomes.filter(outcome => TERMINAL.has(outcome.status)).length, counts }
  })
  const metadata = Object.fromEntries(['model', 'runner', 'provider'].filter(key => typeof raw.metadata?.[key] === 'string').map(key => [key, cleanText(raw.metadata[key], 300)]))
  if (Array.isArray(raw.metadata?.tags)) metadata.tags = raw.metadata.tags.slice(0, 100).filter(tag => typeof tag === 'string').map(tag => cleanText(tag, 100))
  const activeRecords = Array.isArray(raw.active) ? raw.active : isRecord(raw.active) ? [raw.active] : []
  const active = activeRecords.slice(0, 100).filter(record => isRecord(record) && cases.some(caseRecord => caseRecord.id === record.caseId) && laneIds.includes(record.laneId ?? record.lane)).map(record => ({ caseId: record.caseId, laneId: record.laneId ?? record.lane, phase: cleanText(record.phase || '', 300), metrics: normalizeMetrics(record.metrics), startedAt: timestamp(record.startedAt), lastActivityAt: timestamp(record.lastActivityAt), ...(Number.isSafeInteger(record.toolCalls) ? { toolCalls: record.toolCalls } : {}) }))
  const updatedAt = timestamp(raw.updatedAt) || timestamp(mtime)
  return { id: registrationId(root), producerId, name: cleanText(raw.name || path.basename(root), 300), status: RUN_STATUSES.includes(raw.status) ? raw.status : 'unknown', metadata, metrics: normalizeMetrics(raw.metrics), source, startedAt: timestamp(raw.startedAt), updatedAt, finishedAt: timestamp(raw.finishedAt), stale: Boolean(updatedAt && now - Date.parse(updatedAt) > 5 * 60 * 1000), error: null, lanes, cases, active }
}
export function errorExperiment(root, message) {
  return { id: registrationId(root), producerId: path.basename(root), name: path.basename(root), status: 'error', metadata: {}, metrics: { availability: 'not-reported' }, source: 'unavailable', startedAt: null, updatedAt: null, finishedAt: null, stale: false, error: cleanText(message, 1000).replaceAll(root, '<experiment>'), lanes: [], cases: [], active: [] }
}
export function experimentSummary(experiment) {
  const { cases, ...summary } = experiment
  return { ...summary, caseCount: cases.length }
}
