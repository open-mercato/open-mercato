import { buildConformance, evaluateConformance, sequenceModel, type ConformanceTrace } from '../conformance'
import { designedModelSchema, type DesignedProcessModel } from '../types'
import {
  BASE_MS,
  DAY_MS,
  actorOf,
  buildContext,
  caseIdOf,
  creation,
  prepareRows,
  stepRow,
  windowOf,
} from './analyticsTestSupport'

const EXPECTED = ['created', 'status:open', 'status:qualified', 'status:won']

function trace(index: number, activityKeys: string[], actorCount = 3): ConformanceTrace {
  return {
    caseId: caseIdOf(index),
    organizationId: '22222222-0000-4000-8000-000000000001',
    activityKeys,
    actors: Array.from({ length: actorCount }, (_unused, actor) => actorOf(actor + 1)),
  }
}

function workflowModel(key: string, version: number): DesignedProcessModel {
  return designedModelSchema.parse({
    key,
    source: { kind: 'workflow', definitionId: 'wf-deals', version },
    steps: ['draft', 'review', 'closed'],
    transitions: [['draft', 'review'], ['review', 'closed'], ['review', 'draft']],
    startSteps: ['draft'],
    endSteps: ['closed'],
    activityStepMap: { created: 'draft', 'status:open': 'draft', 'status:qualified': 'review', 'status:won': 'closed', 'status:lost': 'closed' },
  })
}

describe('X-Ray conformance', () => {
  it('measures fitness against an ordered list of expected activities', () => {
    const traces = [
      ...Array.from({ length: 6 }, (_unused, index) => trace(index + 1, EXPECTED)),
      ...Array.from({ length: 5 }, (_unused, index) => trace(index + 20, ['created', 'status:open', 'status:won'])),
    ]
    const evaluation = evaluateConformance(traces, { models: [sequenceModel(EXPECTED)], k: 5 })
    if (evaluation.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(evaluation.coverage).toBe(1)
    const model = evaluation.models[0]
    expect(model).toEqual(expect.objectContaining({ n: 11, conformingCases: 6, lowConfidence: true }))
    expect(model.fitness).toBeCloseTo(6 / 11, 10)
    expect(model.fitnessLowerBound).toBeLessThan(6 / 11)
    expect(model.deviations).toEqual([{ kind: 'invalid_transition', from: 'status:open', to: 'status:won', cases: 5 }])
    expect(model.transitions).toEqual({ total: 6 * 3 + 5 * 2, allowed: 6 * 3 + 5 })
  })

  it('refuses when less than 60 % of the observed steps map onto the model', () => {
    const traces = Array.from({ length: 6 }, (_unused, index) => trace(index + 1, ['created', 'status:open', 'priority:high', 'stage:a', 'stage:b']))
    const evaluation = evaluateConformance(traces, { models: [sequenceModel(EXPECTED)], k: 5 })
    expect(evaluation.status).toBe('refused')
    if (evaluation.status !== 'refused') return
    expect(evaluation.reason).toBe('insufficient_coverage')
    expect(evaluation.coverage).toBeCloseTo(0.4, 10)
    expect(evaluateConformance([], { models: [sequenceModel(EXPECTED)], k: 5 })).toEqual(expect.objectContaining({ status: 'refused', reason: 'no_cases' }))
  })

  it('compares each case with the definition version it executed and merges steps mapped together', () => {
    const v1 = workflowModel('wf-deals@1', 1)
    const v2 = designedModelSchema.parse({ ...workflowModel('wf-deals@2', 2), transitions: [['draft', 'closed']] })
    const traces = [
      ...Array.from({ length: 5 }, (_unused, index) => trace(index + 1, EXPECTED)),
      ...Array.from({ length: 5 }, (_unused, index) => trace(index + 10, EXPECTED)),
      trace(99, EXPECTED),
    ]
    const caseModelKeys = Object.fromEntries([
      ...traces.slice(0, 5).map((entry) => [entry.caseId, 'wf-deals@1']),
      ...traces.slice(5, 10).map((entry) => [entry.caseId, 'wf-deals@2']),
    ])
    const evaluation = evaluateConformance(traces, { models: [v1, v2], caseModelKeys, k: 5 })
    if (evaluation.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(evaluation.unresolvedCases).toBe(1)
    const [first, second] = evaluation.models
    expect(first).toEqual(expect.objectContaining({ key: 'wf-deals@1', n: 5, conformingCases: 5, fitness: 1 }))
    expect(first.transitions).toEqual({ total: 10, allowed: 10 })
    expect(second).toEqual(expect.objectContaining({ key: 'wf-deals@2', n: 5, conformingCases: 0 }))
    expect(second.deviations).toEqual([
      { kind: 'invalid_transition', from: 'draft', to: 'review', cases: 5 },
      { kind: 'invalid_transition', from: 'review', to: 'closed', cases: 5 },
    ])
  })

  it('suppresses deviation cells with fewer than k cases or three actors', () => {
    const traces = [
      ...Array.from({ length: 8 }, (_unused, index) => trace(index + 1, EXPECTED)),
      trace(50, ['status:open', 'status:won']),
      trace(51, ['created', 'status:won', 'status:qualified'], 2),
    ]
    const evaluation = evaluateConformance(traces, { models: [sequenceModel(EXPECTED)], k: 5 })
    if (evaluation.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(evaluation.models[0].deviations).toEqual([])
    expect(evaluation.models[0].conformingCases).toBeNull()
    expect(evaluation.suppression.summary().cells).toBeGreaterThanOrEqual(3)
  })

  it('withholds the conforming count when the conforming or the deviating cases fall under the thresholds', () => {
    const deviating = ['created', 'status:open', 'status:won']
    const withheld = evaluateConformance([
      ...Array.from({ length: 8 }, (_unused, index) => trace(index + 1, EXPECTED)),
      trace(50, deviating),
      trace(51, deviating),
    ], { models: [sequenceModel(EXPECTED)], k: 5 })
    if (withheld.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(withheld.models[0]).toEqual(expect.objectContaining({ n: 10, conformingCases: null, fitness: null, fitnessLowerBound: null, transitions: null, deviations: [] }))
    const shown = evaluateConformance([
      ...Array.from({ length: 6 }, (_unused, index) => trace(index + 1, EXPECTED)),
      ...Array.from({ length: 5 }, (_unused, index) => trace(index + 20, deviating)),
    ], { models: [sequenceModel(EXPECTED)], k: 5 })
    if (shown.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(shown.models[0]).toEqual(expect.objectContaining({ n: 11, conformingCases: 6, transitions: { total: 28, allowed: 23 } }))
  })

  it('reports unmapped activities as cells: hidden below k cases or three actors, with complementary suppression', () => {
    const widespread = Array.from({ length: 6 }, (_unused, index) => trace(index + 1, [...EXPECTED, 'priority:high']))
    const lone = trace(30, [...EXPECTED, 'stage:secret'], 1)
    const visible = evaluateConformance([...widespread, ...Array.from({ length: 6 }, (_unused, index) => trace(index + 40, [...EXPECTED, 'stage:shared']))], { models: [sequenceModel(EXPECTED)], k: 5 })
    if (visible.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(visible.unmappedActivities).toEqual([{ activityKey: 'priority:high', events: 6 }, { activityKey: 'stage:shared', events: 6 }])

    const single = evaluateConformance([...widespread, lone], { models: [sequenceModel(EXPECTED)], k: 5 })
    if (single.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(single.unmappedActivities).toEqual([])
    expect(single.suppression.summary()).toEqual(expect.objectContaining({ minCases: expect.any(Number), complementary: expect.any(Number) }))
    expect(single.suppression.summary().complementary).toBeGreaterThanOrEqual(1)

    const fewActors = evaluateConformance(Array.from({ length: 6 }, (_unused, index) => trace(index + 1, [...EXPECTED, 'priority:high'], 2)), { models: [sequenceModel(EXPECTED)], k: 5 })
    if (fewActors.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(fewActors.unmappedActivities).toEqual([])
    expect(fewActors.suppression.summary().minActors).toBeGreaterThanOrEqual(1)
  })

  it('compares each organization with its own model and leaves organizations without one unresolved', () => {
    const otherOrganization = '22222222-0000-4000-8000-000000000002'
    const thirdOrganization = '22222222-0000-4000-8000-000000000003'
    const inOrganization = (index: number, organizationId: string): ConformanceTrace => ({ ...trace(index, EXPECTED), organizationId })
    const traces = [
      ...Array.from({ length: 5 }, (_unused, index) => trace(index + 1, EXPECTED)),
      ...Array.from({ length: 5 }, (_unused, index) => inOrganization(index + 10, otherOrganization)),
      inOrganization(20, thirdOrganization),
    ]
    const strict = designedModelSchema.parse({ ...sequenceModel(['created', 'status:won'], undefined, 'strict'), activityStepMap: { created: 'created', 'status:won': 'status:won', 'status:open': 'created', 'status:qualified': 'created' } })
    const evaluation = evaluateConformance(traces, {
      models: [sequenceModel(EXPECTED), strict],
      organizationModelKeys: { '22222222-0000-4000-8000-000000000001': 'sequence', [otherOrganization]: 'strict' },
      k: 5,
    })
    if (evaluation.status !== 'ok') throw new Error('[internal] expected an evaluation')
    expect(evaluation.unresolvedCases).toBe(1)
    expect(evaluation.models.map((model) => [model.key, model.n, model.conformingCases])).toEqual([['sequence', 5, 5], ['strict', 5, 5]])
    const single = evaluateConformance([inOrganization(30, thirdOrganization)], { models: [sequenceModel(EXPECTED)], organizationModelKeys: {}, k: 5 })
    expect(single).toEqual(expect.objectContaining({ status: 'refused', reason: 'no_cases' }))
  })

  it('validates designed models', () => {
    expect(designedModelSchema.safeParse({
      key: 'broken',
      source: { kind: 'workflow', definitionId: null, version: null },
      steps: ['a'],
      transitions: [['a', 'b']],
      startSteps: ['a'],
      endSteps: ['a'],
      activityStepMap: { created: 'c' },
    }).success).toBe(false)
  })

  it('builds the conformance result from completed traces of the window', () => {
    const window = windowOf(BASE_MS - DAY_MS, BASE_MS + 30 * DAY_MS)
    const cases = Array.from({ length: 6 }, (_unused, index) => {
      const caseId = caseIdOf(index + 1)
      const actor = actorOf((index % 3) + 1)
      return prepareRows(caseId, [
        ...creation(caseId, BASE_MS, { actor }),
        stepRow(caseId, { key: 'status:qualified', atMs: BASE_MS + DAY_MS, actor }),
        stepRow(caseId, { key: 'status:won', atMs: BASE_MS + 2 * DAY_MS, actor }),
      ], window)
    })
    const openCase = caseIdOf(40)
    cases.push(prepareRows(openCase, [...creation(openCase, BASE_MS)], window))
    const result = buildConformance(cases, buildContext(window, { k: 5 }), { models: [sequenceModel(EXPECTED)] })
    expect(result).toEqual(expect.objectContaining({ status: 'ok', n: 6, coverage: 1, minCoverage: 0.6, truncatedCases: 0 }))
  })
})
