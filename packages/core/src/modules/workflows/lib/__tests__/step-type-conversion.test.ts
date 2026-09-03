/**
 * In-place step type conversion (#4237 A9a, spec section 4.5).
 *
 * The binding promise: identity and presentation survive every allowed pair,
 * config the target genuinely shares is mapped, and everything else is
 * quarantined — never dropped.
 */

import { describe, test, expect } from '@jest/globals'
import type { Node, Edge } from '@xyflow/react'
import { graphToDefinition, definitionToGraph } from '../graph-utils'
import { workflowDefinitionDataSchema } from '../../data/validators'
import {
  CONVERTIBLE_STEP_TYPES,
  convertStepType,
  listStepTypeConversionTargets,
  readUnmappedStepConfig,
  type ConvertibleStepType,
} from '../step-type-conversion'

const SOURCE_DATA: Record<ConvertibleStepType, Record<string, unknown>> = {
  userTask: {
    assignedTo: 'user_1',
    assignedToRoles: ['approver'],
    formKey: 'approval',
    userTaskConfig: { assignedTo: 'user_1', slaDuration: 'PT4H' },
  },
  automated: {
    activityType: 'CALL_API',
    activityId: 'call_crm',
    activities: [{ activityId: 'call_crm', activityName: 'Call CRM', activityType: 'CALL_API', config: {} }],
  },
  invokeAgent: {
    agentId: 'triage',
    activities: [{ activityId: 'invoke_agent', activityName: 'Invoke Agent', activityType: 'INVOKE_AGENT', config: {} }],
    signalConfig: { signalName: 'agent_orchestrator.proposal.ready' },
  },
  subWorkflow: {
    config: { subWorkflowId: 'child_flow', version: 2, inputMapping: { dealId: '{{context.dealId}}' } },
  },
  waitForSignal: {
    signalConfig: { signalName: 'payment.confirmed', timeout: 'PT30M' },
  },
  waitForTimer: {
    config: { duration: 'PT15M' },
  },
  waitForCondition: {
    config: { condition: { field: 'amount', operator: 'gt', value: 10 }, timeout: 'PT30M', onTimeout: 'FAIL' },
  },
  parallelFork: { config: { joinStepId: 'join_1' } },
  parallelJoin: { config: { forkStepId: 'fork_1' } },
  ifElse: {},
  switch: {},
}

const identity = { label: 'Approve invoice', stepName: 'Approve invoice', description: 'Human sign-off', timeout: 'PT1H' }

const stepOf = (type: ConvertibleStepType) => ({ type, data: { ...identity, badge: 'Old badge', ...SOURCE_DATA[type] } })

const allPairs = CONVERTIBLE_STEP_TYPES.flatMap((source) =>
  CONVERTIBLE_STEP_TYPES.filter((target) => target !== source).map((target) => [source, target] as const),
)

describe('convertStepType — every allowed pair', () => {
  test.each(allPairs)('%s → %s preserves identity and loses nothing', (source, target) => {
    const step = stepOf(source)
    const result = convertStepType(step, target)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.type).toBe(target)
    expect(result.data.label).toBe(identity.label)
    expect(result.data.stepName).toBe(identity.stepName)
    expect(result.data.description).toBe(identity.description)
    expect(result.data.timeout).toBe(identity.timeout)

    // Every source config key is either present on the converted step or held
    // in the quarantine — nothing is silently discarded.
    const quarantine = readUnmappedStepConfig(result.data) ?? {}
    for (const key of Object.keys(SOURCE_DATA[source])) {
      if (key === 'config') continue
      const carried = result.data[key] !== undefined
      const parked = quarantine[key] !== undefined
      const consumedAsDeadline = key === 'signalConfig' && Object.keys(SOURCE_DATA[source][key] as object).length === 1
      expect(carried || parked || consumedAsDeadline).toBe(true)
    }
    const sourceConfig = (SOURCE_DATA[source].config ?? {}) as Record<string, unknown>
    const nextConfig = (result.data.config ?? {}) as Record<string, unknown>
    const quarantinedConfig = (quarantine.config ?? {}) as Record<string, unknown>
    for (const key of Object.keys(sourceConfig)) {
      const carried = nextConfig[key] !== undefined
      const parked = quarantinedConfig[key] !== undefined
      const movedToDeadline = key === 'timeout'
      expect(carried || parked || movedToDeadline).toBe(true)
    }
  })

  test('the source step is never mutated', () => {
    const step = stepOf('userTask')
    const snapshot = JSON.stringify(step)
    convertStepType(step, 'automated')
    expect(JSON.stringify(step)).toBe(snapshot)
  })
})

describe('convertStepType — compatible config mapping', () => {
  test('automated → invokeAgent keeps the activity list', () => {
    const result = convertStepType(stepOf('automated'), 'invokeAgent')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.activities).toEqual(SOURCE_DATA.automated.activities)
    expect(result.quarantined).toEqual([])
    expect(readUnmappedStepConfig(result.data)).toBeNull()
  })

  test('invokeAgent → waitForSignal keeps the signal it parks on', () => {
    const result = convertStepType(stepOf('invokeAgent'), 'waitForSignal')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.signalConfig).toEqual({ signalName: 'agent_orchestrator.proposal.ready' })
    expect(result.quarantined.sort()).toEqual(['activities', 'agentId'])
  })

  test('waitForSignal → waitForCondition carries the deadline into the condition timeout', () => {
    const result = convertStepType(stepOf('waitForSignal'), 'waitForCondition')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data.config as Record<string, unknown>).timeout).toBe('PT30M')
    expect(readUnmappedStepConfig(result.data)).toEqual({ signalConfig: { signalName: 'payment.confirmed' } })
  })

  test('waitForCondition → waitForSignal carries the deadline back and parks the predicate', () => {
    const result = convertStepType(stepOf('waitForCondition'), 'waitForSignal')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.signalConfig).toEqual({ timeout: 'PT30M' })
    const quarantine = readUnmappedStepConfig(result.data)
    expect((quarantine?.config as Record<string, unknown>).condition).toEqual(SOURCE_DATA.waitForCondition.config && (SOURCE_DATA.waitForCondition.config as Record<string, unknown>).condition)
    expect((quarantine?.config as Record<string, unknown>).onTimeout).toBe('FAIL')
  })

  test('waitForTimer duration is parked, not treated as a deadline', () => {
    const result = convertStepType(stepOf('waitForTimer'), 'waitForCondition')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data.config as Record<string, unknown> | undefined)?.timeout).toBeUndefined()
    expect(readUnmappedStepConfig(result.data)).toEqual({ config: { duration: 'PT15M' } })
  })
})

describe('convertStepType — quarantine accumulation', () => {
  test('a second conversion merges into the existing quarantine', () => {
    const first = convertStepType(stepOf('userTask'), 'waitForTimer')
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = convertStepType({ type: 'waitForTimer', data: first.data }, 'automated')
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const quarantine = readUnmappedStepConfig(second.data)
    expect(quarantine?.assignedTo).toBe('user_1')
    expect(quarantine?.userTaskConfig).toEqual(SOURCE_DATA.userTask.userTaskConfig)
  })

  test('converting back recovers what was parked', () => {
    const away = convertStepType(stepOf('waitForSignal'), 'waitForTimer')
    expect(away.ok).toBe(true)
    if (!away.ok) return
    expect(readUnmappedStepConfig(away.data)?.signalConfig).toEqual(SOURCE_DATA.waitForSignal.signalConfig)
  })
})

describe('quarantined config survives persistence', () => {
  test('round-trips through the definition and passes the definition schema', () => {
    const converted = convertStepType(stepOf('userTask'), 'automated')
    expect(converted.ok).toBe(true)
    if (!converted.ok) return

    const nodes: Node[] = [
      { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
      { id: 'notify', type: converted.type, position: { x: 240, y: 0 }, data: converted.data },
      { id: 'end', type: 'end', position: { x: 480, y: 0 }, data: { label: 'End' } },
    ]
    const edges: Edge[] = [
      { id: 't_1', source: 'start', target: 'notify', type: 'workflowTransition', data: { trigger: 'auto' } },
      { id: 't_2', source: 'notify', target: 'end', type: 'workflowTransition', data: { trigger: 'auto' } },
    ]

    const definition = graphToDefinition(nodes, edges, { includePositions: true })
    const step = definition.steps.find((candidate) => candidate.stepId === 'notify') as Record<string, unknown>
    expect((step.metadata as Record<string, unknown>).unmappedConfig).toEqual(readUnmappedStepConfig(converted.data))

    const parsed = workflowDefinitionDataSchema.safeParse(definition)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const parsedStep = parsed.data.steps.find((candidate) => candidate.stepId === 'notify') as Record<string, unknown>
    expect((parsedStep.metadata as Record<string, unknown>).unmappedConfig).toEqual(readUnmappedStepConfig(converted.data))

    const reopened = definitionToGraph(definition as never)
    const reopenedNode = reopened.nodes.find((candidate) => candidate.id === 'notify')
    expect(readUnmappedStepConfig(reopenedNode?.data)).toEqual(readUnmappedStepConfig(converted.data))
  })

  test('a step with nothing quarantined writes no metadata', () => {
    const nodes: Node[] = [
      { id: 'task', type: 'automated', position: { x: 0, y: 0 }, data: { label: 'Task' } },
    ]
    const definition = graphToDefinition(nodes, [])
    expect((definition.steps[0] as Record<string, unknown>).metadata).toBeUndefined()
  })
})

describe('convertStepType — restricted pairs', () => {
  test.each(['start', 'end'])('refuses to convert a %s step', (type) => {
    expect(convertStepType({ type, data: {} }, 'automated')).toEqual({ ok: false, code: 'unsupportedSource' })
  })

  test.each(['start', 'end'])('refuses to convert INTO a %s step', (type) => {
    expect(convertStepType({ type: 'automated', data: {} }, type)).toEqual({ ok: false, code: 'unsupportedTarget' })
  })

  test('refuses a no-op conversion', () => {
    expect(convertStepType({ type: 'automated', data: {} }, 'automated')).toEqual({ ok: false, code: 'sameType' })
  })

  test('lists every other convertible type as a target, never START or END', () => {
    const targets = listStepTypeConversionTargets('automated')
    expect(targets).not.toContain('automated')
    expect(targets).not.toContain('start')
    expect(targets).not.toContain('end')
    expect(targets.length).toBe(CONVERTIBLE_STEP_TYPES.length - 1)
    expect(listStepTypeConversionTargets('start')).toEqual([])
    expect(listStepTypeConversionTargets(undefined)).toEqual([])
  })
})
