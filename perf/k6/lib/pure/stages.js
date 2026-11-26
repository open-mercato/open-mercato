const UNIT_SECONDS = { ms: 0.001, s: 1, m: 60, h: 3600 }

export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return 0
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g
  let total = 0
  let matched = false
  let match = pattern.exec(value)
  while (match) {
    matched = true
    total += Number(match[1]) * UNIT_SECONDS[match[2]]
    match = pattern.exec(value)
  }
  if (!matched && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return total
}

export function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = whole % 60
  return `${hours ? `${hours}h` : ''}${minutes ? `${minutes}m` : ''}${rest || (!hours && !minutes) ? `${rest}s` : ''}`
}

function normalizeStep(entry, defaults) {
  if (typeof entry === 'number') return { vus: entry, ramp: defaults.ramp, hold: defaults.hold }
  return {
    vus: Number(entry.vus ?? entry.target),
    ramp: entry.ramp ?? entry.rampUp ?? defaults.ramp,
    hold: entry.hold ?? entry.duration ?? defaults.hold,
    label: entry.label ?? entry.step,
  }
}

function stressSteps(profile, kneeVus) {
  const knee = Number(kneeVus)
  const hasKnee = Number.isFinite(knee) && knee > 0
  const targets = hasKnee
    ? (profile.multipliers ?? [1.5, 2, 3]).map((factor) => Math.round(knee * factor))
    : (profile.fallbackVus ?? [300, 400, 600])
  const steps = targets.map((vus) => ({ vus, ramp: profile.ramp ?? '1m', hold: profile.hold ?? '5m' }))
  const recovery = profile.recovery ?? { vus: 25, ramp: '1m', hold: '10m' }
  steps.push({ vus: Number(recovery.vus), ramp: recovery.ramp ?? '1m', hold: recovery.hold ?? '10m', label: 'recovery' })
  return steps
}

function soakSteps(profile, kneeVus, soakVus) {
  const explicit = Number(soakVus)
  const knee = Number(kneeVus)
  const vus = Number.isFinite(explicit) && explicit > 0
    ? explicit
    : Number.isFinite(knee) && knee > 0
      ? Math.max(1, Math.round(knee * Number(profile.fraction ?? 0.5)))
      : Number(profile.fallbackVus ?? 50)
  return [{ vus, ramp: profile.ramp ?? '5m', hold: profile.hold ?? '4h' }]
}

export function resolveProfileSteps(profile, options = {}) {
  if (!profile) throw new Error('[internal] unknown load profile')
  if (Array.isArray(profile.stages)) {
    return profile.stages.map((stage, index) => ({ vus: Number(stage.target), ramp: stage.duration, hold: 0, label: String(index + 1) }))
  }
  const kind = profile.kind ?? (profile.multipliers ? 'stress' : profile.fraction ? 'soak' : 'steps')
  if (kind === 'stress') return stressSteps(profile, options.kneeVus)
  if (kind === 'soak') return soakSteps(profile, options.kneeVus, options.soakVus)
  const defaults = { ramp: profile.ramp ?? '2m', hold: profile.hold ?? '10m' }
  return (profile.steps ?? []).map((entry) => normalizeStep(entry, defaults))
}

function pushSegment(timeline, segment) {
  const startSec = timeline.length ? timeline[timeline.length - 1].endSec : 0
  if (segment.durationSec <= 0) return
  timeline.push({ ...segment, startSec, endSec: startSec + segment.durationSec })
}

export function buildTimeline(steps, { warmup } = {}) {
  const timeline = []
  if (warmup && Number(warmup.vus) > 0 && parseDuration(warmup.duration) > 0) {
    const total = parseDuration(warmup.duration)
    const ramp = Math.min(30, total / 2)
    pushSegment(timeline, { step: 'warmup', stage: 'ramp', target: Number(warmup.vus), durationSec: ramp, measured: false })
    pushSegment(timeline, { step: 'warmup', stage: 'hold', target: Number(warmup.vus), durationSec: total - ramp, measured: false })
  }
  steps.forEach((step, index) => {
    const label = step.label ?? String(index + 1)
    pushSegment(timeline, { step: label, stage: 'ramp', target: step.vus, durationSec: parseDuration(step.ramp), measured: true })
    pushSegment(timeline, { step: label, stage: 'hold', target: step.vus, durationSec: parseDuration(step.hold), measured: true })
  })
  return timeline
}

export function timelineToStages(timeline) {
  return timeline.map((segment) => ({ duration: formatDuration(segment.durationSec), target: segment.target }))
}

export function timelineDuration(timeline) {
  return timeline.length ? timeline[timeline.length - 1].endSec : 0
}

export function resolveSegmentAt(timeline, elapsedSec) {
  if (!timeline.length) return { step: 'none', stage: 'none', measured: false }
  for (const segment of timeline) {
    if (elapsedSec < segment.endSec) return segment
  }
  return timeline[timeline.length - 1]
}

export function maxTarget(timeline) {
  return timeline.reduce((max, segment) => Math.max(max, segment.target), 0)
}
