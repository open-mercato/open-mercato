/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { classifyRunEventType, isRunMilestoneEvent } from '../run-event-tone'
import { WorkflowEventTypes } from '../event-logger'

describe('classifyRunEventType', () => {
  test('a failure is a failure even when it happened during compensation', () => {
    // The previous inline chain tested `includes('COMPENSATION')` FIRST, so a
    // failed rollback step painted the same warning colour as a routine one.
    expect(classifyRunEventType('COMPENSATION_ACTIVITY_FAILED')).toBe('error')
    expect(classifyRunEventType('COMPENSATION_FAILED')).toBe('error')
  })

  test('a routine compensation event stays a warning', () => {
    expect(classifyRunEventType('COMPENSATION_STARTED')).toBe('warning')
    expect(classifyRunEventType('COMPENSATION_ACTIVITY_COMPLETED')).toBe('warning')
  })

  test('error-routing events are warnings rather than falling through to neutral', () => {
    expect(classifyRunEventType(WorkflowEventTypes.ERROR_ROUTED)).toBe('warning')
    expect(classifyRunEventType(WorkflowEventTypes.ERROR_PARKED)).toBe('warning')
    expect(classifyRunEventType(WorkflowEventTypes.OUTCOME_UNHANDLED)).toBe('warning')
  })

  test('a routed outcome is informational, not a warning', () => {
    expect(classifyRunEventType(WorkflowEventTypes.OUTCOME_ROUTED)).toBe('info')
  })

  test('the ordinary lifecycle vocabulary keeps its tones', () => {
    expect(classifyRunEventType(WorkflowEventTypes.STEP_ENTERED)).toBe('info')
    expect(classifyRunEventType(WorkflowEventTypes.STEP_EXITED)).toBe('success')
    expect(classifyRunEventType(WorkflowEventTypes.STEP_FAILED)).toBe('error')
    expect(classifyRunEventType(WorkflowEventTypes.WORKFLOW_COMPLETED)).toBe('success')
    expect(classifyRunEventType(WorkflowEventTypes.WORKFLOW_CANCELLED)).toBe('neutral')
    expect(classifyRunEventType(WorkflowEventTypes.TRANSITION_REJECTED)).toBe('error')
    expect(classifyRunEventType(WorkflowEventTypes.SIGNAL_TIMEOUT)).toBe('error')
    expect(classifyRunEventType(WorkflowEventTypes.USER_TASK_ESCALATED)).toBe('warning')
  })

  test('the legacy PascalCase spellings classify the same way', () => {
    expect(classifyRunEventType('StepExited')).toBe('success')
    expect(classifyRunEventType('StepEntered')).toBe('info')
    expect(classifyRunEventType('StepFailed')).toBe('error')
  })

  test('every declared event type resolves to a tone', () => {
    for (const eventType of Object.values(WorkflowEventTypes)) {
      expect(['success', 'error', 'warning', 'info', 'neutral']).toContain(classifyRunEventType(eventType))
    }
  })

  test('an unknown event type is neutral rather than throwing', () => {
    expect(classifyRunEventType('SOMETHING_NOBODY_DECLARED')).toBe('neutral')
  })
})

describe('isRunMilestoneEvent', () => {
  test('keeps the events that describe the run shape', () => {
    expect(isRunMilestoneEvent(WorkflowEventTypes.STEP_ENTERED)).toBe(true)
    expect(isRunMilestoneEvent(WorkflowEventTypes.WORKFLOW_STARTED)).toBe(true)
    expect(isRunMilestoneEvent(WorkflowEventTypes.TRANSITION_EXECUTED)).toBe(true)
    expect(isRunMilestoneEvent(WorkflowEventTypes.ERROR_ROUTED)).toBe(true)
    expect(isRunMilestoneEvent(WorkflowEventTypes.OUTCOME_ROUTED)).toBe(true)
  })

  test('drops the per-activity bookkeeping the Raw tab still shows', () => {
    expect(isRunMilestoneEvent(WorkflowEventTypes.ACTIVITY_RETRY)).toBe(false)
    expect(isRunMilestoneEvent(WorkflowEventTypes.USER_TASK_ASSIGNED)).toBe(false)
  })
})
