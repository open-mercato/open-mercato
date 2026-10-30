/**
 * Component flag tests (Phase 2) — validator refinement + standalone guard.
 */

import { describe, test, expect } from '@jest/globals'
import { createWorkflowDefinitionInputCheckedSchema } from '../../data/validators'
import { isComponentKind } from '../component-guard'

const validDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [{ transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
}

const trigger = { triggerId: 'on_order', name: 'On Order', eventPattern: 'sales.orders.created' }

const COMPONENT_TRIGGER_MESSAGE = 'A component workflow cannot declare event triggers'

describe('component flag', () => {
  describe('isComponentKind', () => {
    test('is true only for component', () => {
      expect(isComponentKind('component')).toBe(true)
      expect(isComponentKind('workflow')).toBe(false)
      expect(isComponentKind(undefined)).toBe(false)
      expect(isComponentKind(null)).toBe(false)
    })
  })

  describe('component cannot declare triggers', () => {
    test('component + triggers is rejected', () => {
      const result = createWorkflowDefinitionInputCheckedSchema.safeParse({
        workflowId: 'verify_policy',
        workflowName: 'Verify Policy',
        kind: 'component',
        definition: { ...validDefinition, triggers: [trigger] },
      })
      expect(result.success).toBe(false)
      expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
        COMPONENT_TRIGGER_MESSAGE,
      )
    })

    test('component without triggers is valid', () => {
      const result = createWorkflowDefinitionInputCheckedSchema.safeParse({
        workflowId: 'verify_policy',
        workflowName: 'Verify Policy',
        kind: 'component',
        definition: validDefinition,
      })
      expect(result.success).toBe(true)
    })

    test('a normal workflow with triggers is still valid (Q4 — any definition callable)', () => {
      const result = createWorkflowDefinitionInputCheckedSchema.safeParse({
        workflowId: 'order_flow',
        workflowName: 'Order Flow',
        kind: 'workflow',
        definition: { ...validDefinition, triggers: [trigger] },
      })
      expect(result.success).toBe(true)
    })
  })
})
