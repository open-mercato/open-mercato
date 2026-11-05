import { describe, expect, test } from '@jest/globals'
import { workflowsConfig } from '../workflows'
import { eventsConfig } from '../events'

/**
 * Guards issue #4333: the order-approval workflow's auto-start trigger
 * listened for 'sales.orders.created' (plural), but the sales module emits
 * 'sales.order.created' (singular) — the trigger could never fire, so the
 * approval workflow never auto-started for any order. This pins every
 * non-wildcard trigger eventPattern in this module's code-defined workflows
 * to an event the module actually declares (and allows in triggers).
 */
describe('sales code-defined workflow triggers', () => {
  const triggerableEventIds = new Set(
    eventsConfig.events
      .filter((event) => !event.excludeFromTriggers)
      .map((event) => event.id),
  )

  const triggers = workflowsConfig.workflows.flatMap((workflow) =>
    (workflow.definition.triggers ?? []).map((trigger) => ({
      workflowId: workflow.workflowId,
      triggerId: trigger.triggerId,
      eventPattern: trigger.eventPattern,
    })),
  )

  test('module ships workflow triggers to guard', () => {
    expect(triggers.length).toBeGreaterThan(0)
  })

  test.each(triggers.map((entry) => [
    `${entry.workflowId} / ${entry.triggerId}`,
    entry,
  ] as const))('%s listens for a declared, triggerable event', (_label, entry) => {
    if (entry.eventPattern.includes('*')) return
    expect(triggerableEventIds).toContain(entry.eventPattern)
  })

  test('order approval trigger listens for the singular order-created event', () => {
    const orderApproval = workflowsConfig.workflows.find(
      (workflow) => workflow.workflowId === 'sales.order-approval',
    )
    const trigger = orderApproval?.definition.triggers?.find(
      (entry) => entry.triggerId === 'order_approval_trigger',
    )
    expect(trigger?.eventPattern).toBe('sales.order.created')
  })
})
