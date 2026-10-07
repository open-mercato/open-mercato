/**
 * Notification quick-action rule (spec §6.2).
 *
 * *"Notification quick-actions complete a decision inline only when the task
 * has exactly one-click semantics: no editable-prefilled fields and no required
 * comment — otherwise the quick action deep-links to the full task."*
 */

import { describe, test, expect } from '@jest/globals'
import {
  TASK_COMPLETE_COMMAND_ID,
  TASK_QUICK_ACTION_COMPLETE_ID,
  TASK_QUICK_ACTION_VIEW_ID,
  buildTaskQuickActions,
  isOneClickTask,
  resolveTaskPrimaryActionId,
} from '../task-quick-action'

describe('isOneClickTask — the true direction', () => {
  test('a single-decision task with no form and no prefilled fields is one click', () => {
    expect(isOneClickTask({ decisions: [{ id: 'approve' }] })).toBe(true)
  })

  test('a task with no decisions at all is still one click: complete and move on', () => {
    expect(isOneClickTask({ decisions: [] })).toBe(true)
    expect(isOneClickTask({})).toBe(true)
  })

  test('an empty form schema in either shape does not disqualify a task', () => {
    expect(isOneClickTask({ decisions: [{ id: 'ok' }], formSchema: { fields: [] } })).toBe(true)
    expect(isOneClickTask({ decisions: [{ id: 'ok' }], formSchema: { properties: {} } })).toBe(true)
    expect(isOneClickTask({ decisions: [{ id: 'ok' }], formSchema: null })).toBe(true)
  })
})

describe('isOneClickTask — the false direction', () => {
  test('editable-prefilled fields disqualify it, verbatim from the spec', () => {
    expect(
      isOneClickTask({ decisions: [{ id: 'approve' }], editablePrefilled: ['amount'] })
    ).toBe(false)
  })

  test('a required comment disqualifies it', () => {
    expect(isOneClickTask({ decisions: [{ id: 'approve' }], requiresComment: true })).toBe(false)
  })

  test('any form field disqualifies it — the notification cannot collect input', () => {
    expect(
      isOneClickTask({
        decisions: [{ id: 'approve' }],
        formSchema: { fields: [{ name: 'reason', type: 'text', label: 'Reason' }] },
      })
    ).toBe(false)

    expect(
      isOneClickTask({
        decisions: [{ id: 'approve' }],
        formSchema: { properties: { reason: { type: 'string' } } },
      })
    ).toBe(false)
  })

  test('two decisions disqualify it: the pressed button cannot reach the command', () => {
    expect(isOneClickTask({ decisions: [{ id: 'approve' }, { id: 'reject' }] })).toBe(false)
  })
})

describe('buildTaskQuickActions', () => {
  test('a one-click task produces a command-backed completion action', () => {
    const actions = buildTaskQuickActions({ decisions: [{ id: 'approve' }] })

    expect(actions.map((action) => action.id)).toEqual([
      TASK_QUICK_ACTION_VIEW_ID,
      TASK_QUICK_ACTION_COMPLETE_ID,
    ])
    const complete = actions.find((action) => action.id === TASK_QUICK_ACTION_COMPLETE_ID)
    expect(complete?.commandId).toBe(TASK_COMPLETE_COMMAND_ID)
    expect(complete?.href).toBeUndefined()
    expect(resolveTaskPrimaryActionId({ decisions: [{ id: 'approve' }] })).toBe(
      TASK_QUICK_ACTION_COMPLETE_ID
    )
  })

  test('a multi-field task produces the deep link only', () => {
    const input = {
      decisions: [{ id: 'approve' }],
      formSchema: { properties: { amount: { type: 'number' }, reason: { type: 'string' } } },
    }
    const actions = buildTaskQuickActions(input)

    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe(TASK_QUICK_ACTION_VIEW_ID)
    expect(actions[0].href).toBe('/backend/tasks/{sourceEntityId}')
    expect(actions[0].commandId).toBeUndefined()
    expect(resolveTaskPrimaryActionId(input)).toBe(TASK_QUICK_ACTION_VIEW_ID)
  })

  test('the deep link is always offered — a quick action is a shortcut, never the only way in', () => {
    for (const input of [
      { decisions: [{ id: 'approve' }] },
      { decisions: [{ id: 'approve' }, { id: 'reject' }] },
      { decisions: [{ id: 'approve' }], editablePrefilled: ['amount'] },
    ]) {
      expect(buildTaskQuickActions(input).some((action) => action.href)).toBe(true)
    }
  })

  test('no action ever declares confirmRequired — no confirm dialog exists to honour it', () => {
    const actions = buildTaskQuickActions({ decisions: [{ id: 'approve' }] })
    expect(actions.every((action) => !action.confirmRequired)).toBe(true)
  })
})
