import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildTimeline,
  formatDuration,
  maxTarget,
  parseDuration,
  resolveProfileSteps,
  resolveSegmentAt,
  timelineDuration,
  timelineToStages,
} from '../../perf/k6/lib/pure/stages.js'
import { DEFAULT_WORKLOAD, normalizeWorkload } from '../../perf/k6/lib/pure/workload.js'
import { buildQuery, createErrorWindow, monthWindow, nextStageId, sortHonored, withQuery } from '../../perf/k6/lib/pure/misc.js'
import { endpointNames, referenceThresholds, safetyThresholds } from '../../perf/k6/lib/pure/endpoints.js'
import { evaluateReference, renderTextSummary } from '../../perf/k6/lib/pure/summary-text.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('parseDuration and formatDuration round-trip k6 durations', () => {
  assert.equal(parseDuration('2m'), 120)
  assert.equal(parseDuration('1h30m'), 5400)
  assert.equal(parseDuration('45s'), 45)
  assert.equal(parseDuration('500ms'), 0.5)
  assert.equal(parseDuration(90), 90)
  assert.equal(parseDuration(''), 0)
  assert.equal(formatDuration(5400), '1h30m')
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(150), '2m30s')
})

test('step profile builds warmup plus ramp/hold segments per step', () => {
  const steps = resolveProfileSteps(DEFAULT_WORKLOAD.profiles.step)
  assert.deepEqual(steps.map((step) => step.vus), [10, 25, 50, 100, 200])
  const timeline = buildTimeline(steps, { warmup: DEFAULT_WORKLOAD.warmup })
  assert.equal(timeline[0].step, 'warmup')
  assert.equal(timeline[0].measured, false)
  assert.equal(timeline.filter((segment) => segment.step === 'warmup').reduce((sum, segment) => sum + segment.durationSec, 0), 180)
  assert.equal(timelineDuration(timeline), 180 + 5 * (120 + 600))
  assert.equal(maxTarget(timeline), 200)
  const stages = timelineToStages(timeline)
  assert.equal(stages.length, timeline.length)
  assert.deepEqual(stages[2], { duration: '2m', target: 10 })
  assert.deepEqual(stages[stages.length - 1], { duration: '10m', target: 200 })
})

test('resolveSegmentAt maps elapsed time to step and stage tags', () => {
  const timeline = buildTimeline(resolveProfileSteps(DEFAULT_WORKLOAD.profiles.mini), { warmup: DEFAULT_WORKLOAD.warmup })
  assert.equal(resolveSegmentAt(timeline, 0).step, 'warmup')
  assert.equal(resolveSegmentAt(timeline, 179).step, 'warmup')
  assert.deepEqual(
    { step: resolveSegmentAt(timeline, 181).step, stage: resolveSegmentAt(timeline, 181).stage, measured: resolveSegmentAt(timeline, 181).measured },
    { step: '1', stage: 'ramp', measured: true },
  )
  assert.equal(resolveSegmentAt(timeline, 180 + 60 + 10).stage, 'hold')
  assert.equal(resolveSegmentAt(timeline, 180 + 60 + 300 + 5).step, '2')
  assert.equal(resolveSegmentAt(timeline, 1e9).step, '2')
  assert.equal(resolveSegmentAt([], 10).step, 'none')
})

test('stress profile multiplies the knee and appends recovery', () => {
  const withKnee = resolveProfileSteps(DEFAULT_WORKLOAD.profiles.stress, { kneeVus: 40 })
  assert.deepEqual(withKnee.map((step) => step.vus), [60, 80, 120, 25])
  assert.equal(withKnee[withKnee.length - 1].label, 'recovery')
  const noKnee = resolveProfileSteps(DEFAULT_WORKLOAD.profiles.stress, {})
  assert.deepEqual(noKnee.map((step) => step.vus), [300, 400, 600, 25])
  const timeline = buildTimeline(noKnee)
  assert.equal(timeline[timeline.length - 1].step, 'recovery')
})

test('soak profile uses SOAK_VUS, then the knee fraction, then the fallback', () => {
  const profile = DEFAULT_WORKLOAD.profiles.soak
  assert.equal(resolveProfileSteps(profile, { soakVus: 33 })[0].vus, 33)
  assert.equal(resolveProfileSteps(profile, { kneeVus: 90 })[0].vus, 45)
  assert.equal(resolveProfileSteps(profile, {})[0].vus, 50)
  assert.equal(parseDuration(resolveProfileSteps(profile, {})[0].hold), 4 * 3600)
})

test('raw k6 stages in a profile are passed through', () => {
  const steps = resolveProfileSteps({ stages: [{ duration: '1m', target: 5 }, { duration: '2m', target: 5 }] })
  assert.deepEqual(steps.map((step) => step.vus), [5, 5])
  assert.throws(() => resolveProfileSteps(undefined))
})

test('normalizeWorkload deep-merges overrides and tolerates aliases', () => {
  const merged = normalizeWorkload({ thinkTime: { min: 1, max: 2 }, safety: { maxP95Ms: 1000 } })
  assert.equal(merged.thinkTime.minSeconds, 1)
  assert.equal(merged.thinkTime.maxSeconds, 2)
  assert.equal(merged.safety.maxP95Ms, 1000)
  assert.equal(merged.safety.maxErrorRate, 0.2)
  assert.deepEqual(Object.keys(merged.groups), ['read', 'write', 'heavy'])
  const aliased = normalizeWorkload({ mix: [{ group: 'read', weight: 1, journeys: { dashboard: 1 } }], think: [3, 4] })
  assert.deepEqual(aliased.groups, { read: { share: 1, journeys: { dashboard: 1 } } })
  assert.deepEqual([aliased.thinkTime.minSeconds, aliased.thinkTime.maxSeconds], [3, 4])
  assert.deepEqual(normalizeWorkload(null).groups, DEFAULT_WORKLOAD.groups)
})

test('the committed workload.json resolves every profile and only names known journeys', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'perf/config/workload.json'), 'utf8'))
  const workload = normalizeWorkload(raw)
  const known = new Set(Object.values(DEFAULT_WORKLOAD.groups).flatMap((group) => Object.keys(group.journeys)))
  for (const group of Object.values(workload.groups)) {
    for (const journey of Object.keys(group.journeys)) assert.ok(known.has(journey), `unknown journey ${journey}`)
  }
  for (const name of Object.keys(workload.profiles)) {
    const timeline = buildTimeline(resolveProfileSteps(workload.profiles[name], {}), { warmup: workload.warmup })
    assert.ok(timelineDuration(timeline) > 0, `profile ${name} has no duration`)
  }
})

test('buildQuery repeats arrays and skips empty values', () => {
  assert.equal(buildQuery({ entityId: ['a:b', 'c'], page: 1, empty: '', none: null, missing: undefined }), 'entityId=a%3Ab&entityId=c&page=1')
  assert.equal(withQuery('/api/x', { q: 'a b' }), '/api/x?q=a%20b')
  assert.equal(withQuery('/api/x?y=1', { q: 'z' }), '/api/x?y=1&q=z')
  assert.equal(withQuery('/api/x', {}), '/api/x')
})

test('monthWindow pads the current month by a week on both sides', () => {
  const window = monthWindow(new Date(Date.UTC(2026, 10, 15)))
  assert.equal(window.from, '2026-10-25T00:00:00.000Z')
  assert.equal(window.to, '2026-12-08T00:00:00.000Z')
})

test('nextStageId advances by order and wraps around', () => {
  const stages = [{ id: 'b', order: 1 }, { id: 'a', order: 0 }, { id: 'c', order: 2 }]
  assert.equal(nextStageId(stages, 'a'), 'b')
  assert.equal(nextStageId(stages, 'c'), 'a')
  assert.equal(nextStageId(stages, 'unknown'), 'a')
  assert.equal(nextStageId([], 'a'), undefined)
})

test('createErrorWindow trips only on a sustained, sufficiently sampled error rate', () => {
  const record = createErrorWindow({ windowMs: 1000, minSamples: 10, maxErrorRate: 0.2 })
  let state
  for (let index = 0; index < 5; index += 1) state = record(index * 10, true)
  assert.equal(state.tripped, false)
  for (let index = 0; index < 100; index += 1) state = record(index * 10, index % 2 === 0)
  assert.equal(state.tripped, true)
  const healthy = createErrorWindow({ windowMs: 1000, minSamples: 10, maxErrorRate: 0.2 })
  for (let index = 0; index < 200; index += 1) state = healthy(index * 10, index % 10 === 0)
  assert.equal(state.tripped, false)
})

test('sortHonored compares the first item of ascending and descending pages', () => {
  assert.equal(sortHonored([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]), true)
  assert.equal(sortHonored([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }]), false)
  assert.equal(sortHonored([{ id: 1 }], [{ id: 1 }]), null)
})

test('threshold builders emit reference sub-metrics and abort-on-fail safety lines', () => {
  const names = endpointNames()
  assert.ok(names.includes('people.list:list'))
  assert.ok(names.includes('heavy.bulk.owner:poll'))
  assert.equal(new Set(names).size, names.length)
  const reference = referenceThresholds({ endpoints: true, journeys: ['dashboard'] })
  assert.deepEqual(reference['http_req_duration{group:read,measured:1}'], ['max>=0'])
  assert.deepEqual(reference['om_journey_duration{journey:dashboard,measured:1}'], ['max>=0'])
  assert.ok(reference['http_req_duration{name:people.list:list,measured:1}'])
  const safety = safetyThresholds({ maxErrorRate: 0.2, errorWindow: '2m', maxP95Ms: 30000 })
  assert.deepEqual(safety.http_req_failed[0], { threshold: 'rate<0.2', abortOnFail: true, delayAbortEval: '2m' })
  assert.equal(safety.http_req_duration[0].threshold, 'p(95)<30000')
})

test('renderTextSummary reports headline metrics, reference lines and failures', () => {
  const data = {
    state: { testRunDurationMs: 61000 },
    metrics: {
      http_reqs: { type: 'counter', values: { count: 10, rate: 1 } },
      http_req_failed: { type: 'rate', values: { rate: 0.1, passes: 1, fails: 9 } },
      'http_req_duration{group:read,measured:1}': { type: 'trend', values: { med: 100, 'p(95)': 700, 'p(99)': 900, max: 1000, count: 10 } },
      checks: { type: 'rate', values: { rate: 0.5, passes: 1, fails: 1 }, thresholds: { 'rate==1': { ok: false } } },
    },
    root_group: { checks: [{ name: 'people.list:list status', passes: 1, fails: 1 }], groups: [] },
  }
  const text = renderTextSummary(data, { title: 'unit', reference: { readP95Ms: 500, errorRate: 0.01 } })
  assert.match(text, /== unit ==/)
  assert.match(text, /over read p95: 700\.000 \(reference 500\)/)
  assert.match(text, /checks rate==1/)
  assert.match(text, /people\.list:list status: 1 failed/)
  const lines = evaluateReference(data.metrics, { readP95Ms: 500, errorRate: 0.01 })
  assert.deepEqual(lines.map((line) => line.ok), [false, false])
})
