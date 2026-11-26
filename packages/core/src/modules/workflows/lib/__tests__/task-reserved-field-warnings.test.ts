import { describe, test, expect } from '@jest/globals'
import {
  collectFlowLogicWarnings,
  collectTaskReservedFieldWarnings,
  type FlowLogicDefinition,
} from '../flow-logic-warnings'
import { isReservedTaskFieldName, readReservedTaskFormFields } from '../task-form-schema'
import { RESERVED_WORKFLOW_CONTEXT_KEYS } from '../workflow-executor'

function userTask(formSchema: unknown, stepType = 'USER_TASK') {
  return {
    steps: [
      {
        stepId: 'review',
        stepType,
        userTaskConfig: { assignedToRoles: ['approver'], formSchema },
      },
    ],
    transitions: [],
  } as unknown as FlowLogicDefinition
}

describe('issue 9142 reserved task field names', () => {
  test('every engine-reserved context key is a reserved task field name', () => {
    for (const key of RESERVED_WORKFLOW_CONTEXT_KEYS) {
      expect(isReservedTaskFieldName(key)).toBe(true)
    }
    expect(isReservedTaskFieldName('__decision')).toBe(true)
    expect(isReservedTaskFieldName('_note')).toBe(false)
    expect(isReservedTaskFieldName('comments')).toBe(false)
  })

  test('reads reserved names from both formSchema shapes', () => {
    expect(
      readReservedTaskFormFields({ fields: [{ name: '__x', type: 'text' }, { name: 'ok', type: 'text' }] }),
    ).toEqual(['__x'])
    expect(
      readReservedTaskFormFields({ properties: { _pendingAsyncActivities: { type: 'string' }, ok: { type: 'string' } } }),
    ).toEqual(['_pendingAsyncActivities'])
  })

  test('warns once per reserved field on a USER_TASK', () => {
    const warnings = collectTaskReservedFieldWarnings(
      userTask({ fields: [{ name: '__x', type: 'text', required: true }, { name: 'note', type: 'text' }] }),
    )

    expect(warnings).toEqual([
      {
        code: 'taskFieldReservedName',
        path: ['steps', 0],
        params: { stepId: 'review', field: '__x' },
        severity: 'warning',
      },
    ])
  })

  test('is part of the full flow-logic warning set', () => {
    const codes = collectFlowLogicWarnings(userTask({ properties: { __x: { type: 'string' } } })).map(
      (warning) => warning.code,
    )
    expect(codes).toContain('taskFieldReservedName')
  })

  test('raises nothing for ordinary names or for non-task steps', () => {
    expect(collectTaskReservedFieldWarnings(userTask({ fields: [{ name: 'note', type: 'text' }] }))).toEqual([])
    expect(collectTaskReservedFieldWarnings(userTask({ fields: [{ name: '__x', type: 'text' }] }, 'AUTOMATED'))).toEqual([])
  })
})
