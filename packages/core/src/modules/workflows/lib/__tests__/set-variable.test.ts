/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { WorkflowInstance } from '../../data/entities'
import {
  buildSetVariableContextPatch,
  isSetVariableOutput,
  splitAssignmentPath,
} from '../set-variable'
import {
  executeActivities,
  executeSetVariable,
  type ActivityContext,
  type ActivityDefinition,
} from '../activity-executor'

const mockEm = {} as unknown as EntityManager
const mockContainer = {} as unknown as AwilixContainer

const mockInstance = {
  id: 'instance-1',
  workflowId: 'wf-1',
  definitionId: 'def-1',
  currentStepId: 'step-1',
  status: 'RUNNING',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  version: 1,
  context: {},
} as unknown as WorkflowInstance

const buildContext = (workflowContext: Record<string, unknown>): ActivityContext => ({
  workflowInstance: mockInstance,
  workflowContext,
})

describe('splitAssignmentPath', () => {
  test('splits dot paths and trims segments', () => {
    expect(splitAssignmentPath('customer.priority')).toEqual(['customer', 'priority'])
    expect(splitAssignmentPath(' customer . priority ')).toEqual(['customer', 'priority'])
  })

  test('drops empty segments', () => {
    expect(splitAssignmentPath('...')).toEqual([])
    expect(splitAssignmentPath(' ')).toEqual([])
  })

  test('rejects prototype-pollution segments with null', () => {
    expect(splitAssignmentPath('__proto__.x')).toBeNull()
    expect(splitAssignmentPath('a.constructor.y')).toBeNull()
    expect(splitAssignmentPath('a.prototype.b')).toBeNull()
  })
})

describe('isSetVariableOutput', () => {
  test('accepts an output with valid assignments', () => {
    expect(isSetVariableOutput({ assignments: [{ path: 'a.b', value: 1 }] })).toBe(true)
    expect(isSetVariableOutput({ assignments: [{ path: 'flag' }] })).toBe(true)
  })

  test('rejects non-conforming outputs', () => {
    expect(isSetVariableOutput(null)).toBe(false)
    expect(isSetVariableOutput('assignments')).toBe(false)
    expect(isSetVariableOutput({ assignments: 'a.b' })).toBe(false)
    expect(isSetVariableOutput({ assignments: [{ value: 1 }] })).toBe(false)
    expect(isSetVariableOutput({ assignments: [{ path: '...' }] })).toBe(false)
  })

  test('rejects outputs whose paths contain prototype-pollution segments', () => {
    expect(isSetVariableOutput({ assignments: [{ path: '__proto__.polluted', value: 1 }] })).toBe(false)
    expect(isSetVariableOutput({ assignments: [{ path: 'a.constructor.y', value: 1 }] })).toBe(false)
    expect(isSetVariableOutput({ assignments: [{ path: 'a.prototype.b', value: 1 }] })).toBe(false)
  })
})

describe('buildSetVariableContextPatch', () => {
  test('sets top-level values', () => {
    expect(buildSetVariableContextPatch({}, [{ path: 'priority', value: 'high' }])).toEqual({
      priority: 'high',
    })
  })

  test('creates intermediate objects for nested paths', () => {
    expect(
      buildSetVariableContextPatch({}, [{ path: 'customer.address.city', value: 'Poznan' }])
    ).toEqual({ customer: { address: { city: 'Poznan' } } })
  })

  test('preserves sibling keys at every level of an existing nested target', () => {
    const base = {
      customer: { name: 'Ada', address: { city: 'Poznan', zip: '61-001' } },
      untouched: true,
    }
    const patch = buildSetVariableContextPatch(base, [
      { path: 'customer.address.city', value: 'Berlin' },
    ])
    expect(patch).toEqual({
      customer: { name: 'Ada', address: { city: 'Berlin', zip: '61-001' } },
    })
    expect(patch).not.toHaveProperty('untouched')
  })

  test('does not mutate the base context', () => {
    const base = { customer: { name: 'Ada', address: { city: 'Poznan' } } }
    buildSetVariableContextPatch(base, [{ path: 'customer.address.city', value: 'Berlin' }])
    expect(base).toEqual({ customer: { name: 'Ada', address: { city: 'Poznan' } } })
  })

  test('later assignments in the same batch see earlier ones on the same root', () => {
    const patch = buildSetVariableContextPatch({}, [
      { path: 'customer.priority', value: 'high' },
      { path: 'customer.tier', value: 'gold' },
    ])
    expect(patch).toEqual({ customer: { priority: 'high', tier: 'gold' } })
  })

  test('replaces non-object intermediates with fresh objects', () => {
    const patch = buildSetVariableContextPatch({ customer: 'legacy-string' }, [
      { path: 'customer.priority', value: 'high' },
    ])
    expect(patch).toEqual({ customer: { priority: 'high' } })
  })

  test('skips prototype-pollution paths and leaves Object.prototype unpolluted', () => {
    const patch = buildSetVariableContextPatch({}, [
      { path: '__proto__.polluted', value: 'yes' },
      { path: 'a.constructor.y', value: 'yes' },
      { path: 'a.prototype.b', value: 'yes' },
    ])
    expect(patch).toEqual({})
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect({}).not.toHaveProperty('polluted')
  })
})

describe('executeSetVariable', () => {
  test('returns the validated assignments', async () => {
    const output = await executeSetVariable(
      { assignments: [{ path: 'customer.priority', value: 'high' }] },
      buildContext({})
    )
    expect(output).toEqual({ assignments: [{ path: 'customer.priority', value: 'high' }] })
  })

  test('rejects configs without assignments', async () => {
    await expect(executeSetVariable({}, buildContext({}))).rejects.toThrow(
      'SET_VARIABLE config invalid'
    )
    await expect(executeSetVariable({ assignments: [] }, buildContext({}))).rejects.toThrow(
      'SET_VARIABLE config invalid'
    )
  })

  test('rejects assignments whose path has no usable segments', async () => {
    await expect(
      executeSetVariable({ assignments: [{ path: ' . ', value: 1 }] }, buildContext({}))
    ).rejects.toThrow('SET_VARIABLE assignment path is blank')
  })

  test('rejects assignments targeting prototype-pollution segments', async () => {
    for (const path of ['__proto__.polluted', 'a.constructor.y', 'a.prototype.b']) {
      await expect(
        executeSetVariable({ assignments: [{ path, value: 1 }] }, buildContext({}))
      ).rejects.toThrow('SET_VARIABLE assignment path contains a forbidden segment')
    }
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})

describe('executeActivities with SET_VARIABLE', () => {
  const setVariableActivity = (
    activityId: string,
    assignments: Array<{ path: string; value: unknown }>
  ): ActivityDefinition => ({
    activityId,
    activityType: 'SET_VARIABLE',
    config: { assignments },
  })

  test('applies assignments at their paths without namespacing under the activity key', async () => {
    const context = buildContext({ customer: { name: 'Ada' } })

    const results = await executeActivities(
      mockEm,
      mockContainer,
      [setVariableActivity('set-priority', [{ path: 'customer.priority', value: 'high' }])],
      context
    )

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
    expect(context.workflowContext.customer).toEqual({ name: 'Ada', priority: 'high' })
    expect(context.workflowContext.SET_VARIABLE).toBeUndefined()
  })

  test('makes assignments visible to later activities in the same transition', async () => {
    const context = buildContext({})

    await executeActivities(
      mockEm,
      mockContainer,
      [
        setVariableActivity('set-priority', [{ path: 'customer.priority', value: 'high' }]),
        setVariableActivity('copy-priority', [
          { path: 'escalation.level', value: '{{context.customer.priority}}' },
        ]),
      ],
      context
    )

    expect(context.workflowContext.customer).toEqual({ priority: 'high' })
    expect(context.workflowContext.escalation).toEqual({ level: 'high' })
  })
})
