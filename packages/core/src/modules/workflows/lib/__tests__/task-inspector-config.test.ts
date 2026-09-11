import { describe, test, expect } from '@jest/globals'
import type { Node } from '@xyflow/react'
import {
  applyEditedTaskText,
  deriveTaskAssignmentMode,
  draftToOnBreach,
  draftsToEntityBindings,
  entityBindingsToDrafts,
  flattenTaskTextForEditing,
  offsetsToReminders,
  onBreachToDraft,
  readTaskDeadlineDraft,
  remindersToOffsets,
  resolveTaskDeadlinePersistence,
} from '../task-inspector-config'
import { nodeToFormValues, formValuesToNodeUpdates } from '../nodeFormTransforms'
import { graphToDefinition } from '../graph-utils'
import { workflowStepSchema } from '../../data/validators'

/**
 * Step 1.4 — the five §6.1 inspector sections.
 *
 * Two levels are pinned here: the PURE mapping rules ("untouched means
 * unchanged"), and the node → form → node round trip that the dialog's save
 * path runs, because that is where an authored value is actually lost.
 */

function userTaskNode(data: Record<string, unknown>): Node {
  return { id: 'approve', type: 'userTask', position: { x: 0, y: 0 }, data } as Node
}

function roundTrip(data: Record<string, unknown>, edit: (values: any) => void = () => {}) {
  const node = userTaskNode(data)
  const values = nodeToFormValues(node)
  edit(values)
  const updates = formValuesToNodeUpdates(values, node) as Record<string, any>
  return { values, updates, config: updates.userTaskConfig as Record<string, any> }
}

describe('task inspector mapping rules', () => {
  test('localized copy an author never touched keeps its locale map', () => {
    const original = { en: 'Approve it', pl: 'Zatwierdź' }
    const seeded = flattenTaskTextForEditing(original)

    expect(seeded).toBe('Approve it')
    expect(applyEditedTaskText(original, seeded)).toBe(original)
    expect(applyEditedTaskText(original, 'Approve the refund')).toBe('Approve the refund')
    expect(applyEditedTaskText(original, '   ')).toBeUndefined()
  })

  test('the deadline is written back to whichever key already carried it', () => {
    expect(resolveTaskDeadlinePersistence({ slaDuration: 'PT1H' }, 'PT2H')).toEqual({ slaDuration: 'PT2H' })
    expect(resolveTaskDeadlinePersistence({}, 'PT4H')).toEqual({ slaDuration: 'PT4H' })
    expect(resolveTaskDeadlinePersistence({ deadline: { duration: 'PT4H' } }, 'PT8H')).toEqual({
      deadline: { duration: 'PT8H' },
    })
    expect(resolveTaskDeadlinePersistence({ slaDuration: 'PT1H' }, '  ')).toEqual({})
    expect(readTaskDeadlineDraft({ deadline: { duration: 'PT4H' }, slaDuration: 'P30D' })).toBe('PT4H')
    expect(readTaskDeadlineDraft({ slaDuration: 'P30D' })).toBe('P30D')
  })

  test('the assignment tab is derived from the three keys, never stored', () => {
    expect(deriveTaskAssignmentMode({})).toBe('role')
    expect(deriveTaskAssignmentMode({ assignedTo: 'user-1' })).toBe('user')
    expect(deriveTaskAssignmentMode({ assignedTo: '{{context.deal.ownerId}}' })).toBe('dynamic')
    expect(deriveTaskAssignmentMode({ assignedTo: 'user-1', assignmentRule: 'rule-1' })).toBe('rule')
  })

  test('bindings without an entity type or an id path describe nothing and are dropped', () => {
    const drafts = entityBindingsToDrafts([
      { entityType: 'customers:person', idPath: 'context.customerId', label: { en: 'Customer' } },
    ])
    expect(drafts[0].label).toBe('Customer')

    expect(draftsToEntityBindings(drafts)).toEqual([
      { entityType: 'customers:person', idPath: 'context.customerId', label: { en: 'Customer' } },
    ])
    expect(draftsToEntityBindings([{ key: 'a', entityType: '', idPath: 'context.x', label: '' }])).toBeUndefined()
    expect(draftsToEntityBindings([{ key: 'a', entityType: 'sales:order', idPath: ' ', label: '' }])).toBeUndefined()
  })

  test('reminders and the breach action only persist the qualifier they use', () => {
    expect(remindersToOffsets([{ offset: 'PT1H' }])).toEqual(['PT1H'])
    expect(offsetsToReminders(['PT1H', '', '  '])).toEqual([{ offset: 'PT1H' }])
    expect(offsetsToReminders([])).toBeUndefined()

    expect(onBreachToDraft(null)).toEqual({ action: '', reassignTo: '', transitionId: '' })
    expect(draftToOnBreach({ action: '', reassignTo: 'x', transitionId: 'y' })).toBeUndefined()
    expect(draftToOnBreach({ action: 'notify', reassignTo: 'x', transitionId: 'y' })).toEqual({ action: 'notify' })
    expect(draftToOnBreach({ action: 'route', reassignTo: 'x', transitionId: 't_1' })).toEqual({
      action: 'route',
      transitionId: 't_1',
    })
    expect(draftToOnBreach({ action: 'reassign', reassignTo: 'lead', transitionId: 't_1' })).toEqual({
      action: 'reassign',
      reassignTo: 'lead',
    })
  })
})

describe('the inspector sections round trip through the dialog save path', () => {
  test('What: the title and the instructions survive an edit', () => {
    const { config, updates } = roundTrip(
      { stepName: 'Approve', userTaskConfig: { instructions: 'Old copy' } },
      (values) => {
        values.stepName = 'Approve refund for {{context.customerName}}'
        values.taskInstructions = 'Refund {{context.order.total}}.'
      },
    )

    expect(updates.stepName).toBe('Approve refund for {{context.customerName}}')
    expect(config.instructions).toBe('Refund {{context.order.total}}.')
  })

  test('About what: bindings survive and a cleared list is really cleared', () => {
    const stored = [{ entityType: 'sales:order', idPath: 'context.order.id' }]

    const kept = roundTrip({ entityBindings: stored, userTaskConfig: { entityBindings: stored } })
    expect(kept.values.taskEntityBindings).toHaveLength(1)
    expect(kept.config.entityBindings).toEqual(stored)

    const cleared = roundTrip(
      { entityBindings: stored, userTaskConfig: { entityBindings: stored } },
      (values) => {
        values.taskEntityBindings = []
      },
    )
    expect(cleared.config.entityBindings).toBeUndefined()
    expect(cleared.updates.entityBindings).toBeUndefined()
  })

  test('Who: a dynamic assignee keeps its fallback role queue', () => {
    const { values, config } = roundTrip({
      assignedTo: '{{context.deal.ownerId}}',
      assignedToRoles: ['approver'],
      userTaskConfig: { assignedTo: '{{context.deal.ownerId}}', assignedToRoles: ['approver'] },
    })

    expect(values.assignmentMode).toBe('dynamic')
    expect(config.assignedTo).toBe('{{context.deal.ownerId}}')
    expect(config.assignedToRoles).toEqual(['approver'])
  })

  test('When: priority, deadline, reminders and the breach action survive an edit', () => {
    const { config, updates } = roundTrip(
      { userTaskConfig: { slaDuration: 'PT1H' } },
      (values) => {
        values.taskPriority = 'high'
        values.slaDuration = 'PT4H'
        values.taskReminders = ['PT1H', '']
        values.taskOnBreach = { action: 'route', reassignTo: '', transitionId: 't_escalate' }
      },
    )

    expect(config.priority).toBe('high')
    expect(config.slaDuration).toBe('PT4H')
    expect(config.deadline).toBeUndefined()
    expect(config.reminders).toEqual([{ offset: 'PT1H' }])
    expect(config.onBreach).toEqual({ action: 'route', transitionId: 't_escalate' })
    expect(updates.slaDuration).toBe('PT4H')
  })

  test('When: a config that already declares a deadline keeps the modern shape', () => {
    const { config } = roundTrip(
      { deadline: { duration: 'PT4H' }, userTaskConfig: { deadline: { duration: 'PT4H' } } },
      (values) => {
        values.slaDuration = 'PT8H'
      },
    )

    expect(config.deadline).toEqual({ duration: 'PT8H' })
    expect(config.slaDuration).toBeUndefined()
  })

  test('an invalid priority is dropped rather than persisted', () => {
    const { config } = roundTrip({}, (values) => {
      values.taskPriority = 'urgent'
    })
    expect(config.priority).toBeUndefined()
  })

  test('a config declaring none of the new fields saves byte-identically', () => {
    const legacyConfig = {
      assignedTo: 'manager@example.com',
      slaDuration: 'P1D',
      escalationRules: [{ trigger: 'sla_breach', action: 'notify' }],
    }
    // `definitionToGraph` mirrors the assignee onto `node.data`, which is where
    // the dialog reads it from — the fixture matches a real loaded node.
    const { config } = roundTrip({
      stepName: 'Approve',
      assignedTo: 'manager@example.com',
      userTaskConfig: legacyConfig,
    })

    expect(config).toEqual(legacyConfig)
    expect(Object.keys(config)).toEqual(['assignedTo', 'slaDuration', 'escalationRules'])
  })

  test('an untouched save is still a valid step and keeps the legacy inspector fields', () => {
    const node = userTaskNode({
      stepName: 'Approve refund',
      assignedToRoles: ['approver'],
      instructions: { en: 'Check the policy.', pl: 'Sprawdź politykę.' },
      entityBindings: [{ entityType: 'sales:order', idPath: 'context.order.id' }],
      priority: 'high',
      userTaskConfig: {
        assignedToRoles: ['approver'],
        instructions: { en: 'Check the policy.', pl: 'Sprawdź politykę.' },
        entityBindings: [{ entityType: 'sales:order', idPath: 'context.order.id' }],
        priority: 'high',
      },
    })

    const updates = formValuesToNodeUpdates(nodeToFormValues(node), node)
    const saved = graphToDefinition([{ ...node, data: { ...node.data, ...updates } }], [])
    const parsed = workflowStepSchema.parse(saved.steps[0])

    expect(parsed.userTaskConfig?.instructions).toEqual({ en: 'Check the policy.', pl: 'Sprawdź politykę.' })
    expect(parsed.userTaskConfig?.entityBindings).toEqual([
      { entityType: 'sales:order', idPath: 'context.order.id' },
    ])
    expect(parsed.userTaskConfig?.priority).toBe('high')
    expect(parsed.userTaskConfig?.assignedToRoles).toEqual(['approver'])
  })

  test('inspector keys never leak into the Advanced Configuration blob', () => {
    const { values } = roundTrip({
      userTaskConfig: {
        priority: 'low',
        reminders: [{ offset: 'PT1H' }],
        customEscalationChannel: 'slack',
      },
    })

    expect(values.advancedConfig).toEqual({ userTaskConfig: { customEscalationChannel: 'slack' } })
  })
})
