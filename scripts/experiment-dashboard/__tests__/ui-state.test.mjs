import test from 'node:test'
import assert from 'node:assert/strict'
import {
  experimentTotals,
  filterCases,
  metricPresentation,
  selectMetrics,
} from '../ui/state.mjs'

const cases = [
  {
    id: 'case/品質',
    title: 'Build a module',
    group: 'code',
    lanes: {
      'safety/品質': { status: 'pass', diagnostics: [] },
      routing: { status: 'fail', diagnostics: ['Missing route'] },
    },
  },
  {
    id: 'other:case',
    title: 'Inspect a route',
    group: 'review',
    lanes: {
      'safety/品質': { status: 'not-applicable', diagnostics: [] },
      routing: { status: 'running', diagnostics: [] },
    },
  },
]

test('case filters support arbitrary IDs, diagnostics and lane-specific applicability', () => {
  assert.deepEqual(
    filterCases(cases, { query: '品質' }).map((record) => record.id),
    ['case/品質'],
  )
  assert.equal(
    filterCases(cases, { query: 'missing route' })[0].id,
    'case/品質',
  )
  assert.equal(
    filterCases(cases, { laneId: 'safety/品質', status: 'fail' }).length,
    0,
  )
  assert.equal(filterCases(cases, { laneId: 'safety/品質' }).length, 1)
  assert.equal(
    filterCases(cases, { group: 'review', status: 'running' })[0].id,
    'other:case',
  )
})

test('progress totals include failed, blocked and skipped outcomes without treating completion as pass', () => {
  const totals = experimentTotals({
    lanes: [
      {
        total: 5,
        completed: 4,
        totalSource: 'declared',
        counts: { pass: 1, fail: 1, error: 1, blocked: 1 },
      },
      {
        total: 2,
        completed: 1,
        totalSource: 'observed',
        counts: { skipped: 1 },
      },
    ],
  })
  assert.deepEqual(totals, {
    total: 7,
    completed: 5,
    passed: 1,
    failed: 2,
    blocked: 1,
    skipped: 1,
    observed: true,
  })
})

test('token metrics do not invent rates for counts or missing producer metrics', () => {
  assert.deepEqual(metricPresentation({ availability: 'not-reported' }), {
    kind: 'not-reported',
    rate: null,
    stale: false,
  })
  assert.equal(
    metricPresentation({ availability: 'reported', outputTokens: 100 }).rate,
    null,
  )
  assert.equal(
    metricPresentation({ availability: 'reported', outputTokensPerSecond: 0 })
      .rate,
    0,
  )
})

test('stale live rates are hidden while historical response rates remain explicitly scoped', () => {
  const now = Date.now()
  const oldSample = {
    availability: 'reported',
    outputTokensPerSecond: 42,
    sampledAt: new Date(now - 60000).toISOString(),
  }
  assert.deepEqual(
    metricPresentation({ ...oldSample, measurementKind: 'live' }, now),
    { kind: 'live', rate: null, stale: true },
  )
  assert.deepEqual(
    metricPresentation(
      { ...oldSample, measurementKind: 'completed-response', stale: true },
      now,
    ),
    { kind: 'completed-response', rate: 42, stale: false },
  )
})

test('current live activity takes precedence over historical experiment samples', () => {
  const historical = {
    availability: 'reported',
    outputTokensPerSecond: 42,
    measurementKind: 'completed-response',
  }
  const live = {
    availability: 'reported',
    outputTokensPerSecond: 12,
    measurementKind: 'live',
  }
  assert.deepEqual(
    selectMetrics({
      metrics: historical,
      active: [{ caseId: 'case/now', metrics: live }],
    }),
    { metrics: live, caseId: 'case/now' },
  )
  assert.deepEqual(selectMetrics({ metrics: historical, active: [] }), {
    metrics: historical,
    caseId: null,
  })
})

test('prototype-name lanes match only explicitly reported outcomes', () => {
  for (const laneId of ['constructor', 'toString', '__proto__']) {
    const omitted = {
      id: 'omitted',
      title: 'No outcome',
      group: '',
      lanes: {},
    }
    const recorded = {
      id: 'recorded',
      title: 'Recorded outcome',
      group: '',
      lanes: Object.fromEntries([
        [laneId, { status: 'pass', diagnostics: [] }],
      ]),
    }
    assert.deepEqual(
      filterCases([omitted, recorded], { laneId }).map((record) => record.id),
      ['recorded'],
    )
    assert.deepEqual(
      filterCases([omitted, recorded], { laneId, query: 'outcome' }).map(
        (record) => record.id,
      ),
      ['recorded'],
    )
  }
})
