import { randomBetween } from './prng.js'

export function thinkSeconds(rng, { enabled = true, minSeconds = 5, maxSeconds = 30, scale = 1 } = {}) {
  if (!enabled || scale <= 0) return 0
  const low = Math.max(0, Math.min(minSeconds, maxSeconds))
  const high = Math.max(low, Math.max(minSeconds, maxSeconds))
  return randomBetween(rng, low, high) * scale
}

function encodePair(key, value) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
}

export function buildQuery(params) {
  const parts = []
  for (const key of Object.keys(params ?? {})) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') parts.push(encodePair(key, item))
      }
      continue
    }
    parts.push(encodePair(key, value))
  }
  return parts.join('&')
}

export function withQuery(path, params) {
  const query = buildQuery(params)
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

export function monthWindow(now = new Date(), padDays = 7) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const padMs = padDays * 24 * 60 * 60 * 1000
  return { from: new Date(start.getTime() - padMs).toISOString(), to: new Date(end.getTime() + padMs).toISOString() }
}

export function daysAgoIso(days, now = new Date()) {
  const date = new Date(now.getTime())
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

export function nextStageId(stages, currentStageId) {
  const ordered = (Array.isArray(stages) ? stages : [])
    .slice()
    .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0))
  if (ordered.length === 0) return undefined
  const currentIndex = ordered.findIndex((stage) => stage.id === currentStageId)
  return ordered[(currentIndex + 1) % ordered.length].id
}

export function createErrorWindow({ windowMs = 120000, minSamples = 30, maxErrorRate = 0.2 } = {}) {
  const samples = []
  let errors = 0
  return function record(nowMs, isError) {
    samples.push({ at: nowMs, error: Boolean(isError) })
    if (isError) errors += 1
    while (samples.length > 0 && samples[0].at < nowMs - windowMs) {
      if (samples.shift().error) errors -= 1
    }
    const rate = samples.length > 0 ? errors / samples.length : 0
    const covered = samples.length > 0 && nowMs - samples[0].at >= windowMs * 0.9
    return { rate, samples: samples.length, tripped: covered && samples.length >= minSamples && rate > maxErrorRate }
  }
}

export function sortHonored(ascItems, descItems, key = 'id') {
  const ascending = Array.isArray(ascItems) ? ascItems : []
  const descending = Array.isArray(descItems) ? descItems : []
  if (ascending.length < 2 || descending.length < 2) return null
  return ascending[0][key] !== descending[0][key]
}
