/**
 * The Invoke Agent node's Review section (spec §7.5).
 *
 * The properties that matter:
 *  - a step that authored no Review resolves to exactly the descriptor-free
 *    behaviour the disposition service had before the section existed;
 *  - a dynamic assignee that does not resolve falls back to the authored role
 *    queue, never to an unassigned row (which §6.4 makes actable by nobody);
 *  - the breach vocabulary CANNOT express a verdict or a route — the maintainer
 *    decision for this phase is that a breach escalates and never decides.
 */

import { describe, test, expect } from '@jest/globals'
import {
  findAgentReviewConfig,
  findAgentReviewConfigForStep,
  resolveAgentReview,
  resolveAgentReviewBreachHandling,
  toAgentDispositionReview,
} from '../agent-review'
import { agentReviewOnBreachSchema } from '../../data/activity-config-schemas'

const identity = (value: unknown) => value

const makeStep = (review: unknown) => ({
  stepId: 'agent_step',
  activities: [
    { activityType: 'INVOKE_AGENT', config: { agentId: 'deal_enricher', review } },
  ],
})

describe('findAgentReviewConfig', () => {
  test('reads the Review block off the step INVOKE_AGENT activity', () => {
    const review = { assignedToRoles: ['Sales Rep'] }
    expect(findAgentReviewConfig(makeStep(review))).toEqual(review)
  })

  test('a step with no agent activity, or a malformed Review, has no Review', () => {
    expect(findAgentReviewConfig({ activities: [{ activityType: 'SEND_EMAIL', config: {} }] })).toBeNull()
    expect(findAgentReviewConfig(makeStep('not-an-object'))).toBeNull()
    expect(findAgentReviewConfig(makeStep([1, 2]))).toBeNull()
    expect(findAgentReviewConfig(null)).toBeNull()
  })

  test('addresses a step of a definition by id', () => {
    const definition = { steps: [makeStep({ priority: 'high' })] }
    expect(findAgentReviewConfigForStep(definition, 'agent_step')).toEqual({ priority: 'high' })
    expect(findAgentReviewConfigForStep(definition, 'other_step')).toBeNull()
  })
})

describe('resolveAgentReview', () => {
  test('no Review authored resolves to nothing on the wire', () => {
    const resolved = resolveAgentReview(null, identity)

    expect(resolved.assignedTo).toBeNull()
    expect(resolved.assignedToRoles).toBeNull()
    expect(resolved.deadlineDuration).toBeNull()
    expect(toAgentDispositionReview(resolved)).toBeNull()
  })

  test('an individual assignee and a role queue both travel', () => {
    const resolved = resolveAgentReview(
      {
        assignedTo: 'user-1',
        assignedToRoles: ['Sales Rep'],
        priority: 'high',
        deadline: { duration: 'P2D' },
        reminders: [{ offset: 'PT4H' }],
      },
      identity,
    )

    expect(toAgentDispositionReview(resolved)).toEqual({
      assignedTo: 'user-1',
      assignedToRoles: ['Sales Rep'],
      priority: 'high',
      deadlineDuration: 'P2D',
      reminders: [{ offset: 'PT4H' }],
    })
  })

  test('an unresolved dynamic assignee falls back to the role queue, never to nobody', () => {
    const resolved = resolveAgentReview(
      { assignedTo: '{{context.deal.ownerId}}', assignedToRoles: ['Sales Rep'] },
      identity,
    )

    expect(resolved.assignedTo).toBeNull()
    expect(resolved.fellBackToRoles).toBe(true)
    expect(toAgentDispositionReview(resolved)).toEqual({ assignedToRoles: ['Sales Rep'] })
  })

  test('a disposition task is always addressed to the backoffice namespace', () => {
    const resolved = resolveAgentReview({ assignedTo: 'user-1' }, identity)
    expect(resolved.assigneeKind).toBe('user')
  })

  test('an empty reminder list is absent rather than empty', () => {
    const resolved = resolveAgentReview({ reminders: [{ offset: '' }] }, identity)
    expect(resolved.reminders).toBeNull()
  })
})

describe('resolveAgentReviewBreachHandling', () => {
  test('notify, reassign and attention are the whole vocabulary', () => {
    expect(resolveAgentReviewBreachHandling({ action: 'notify' })).toEqual({ kind: 'notify' })
    expect(resolveAgentReviewBreachHandling({ action: 'attention' })).toEqual({ kind: 'attention' })
    expect(
      resolveAgentReviewBreachHandling({ action: 'reassign', reassignTo: 'Supervisor' }),
    ).toEqual({ kind: 'reassign', assignedTo: null, assignedToRoles: ['Supervisor'] })
  })

  test('a reassign with no target is a no-op rather than a guess', () => {
    expect(resolveAgentReviewBreachHandling({ action: 'reassign' })).toEqual({ kind: 'none' })
  })

  test('nothing authored resolves to none', () => {
    expect(resolveAgentReviewBreachHandling(null)).toEqual({ kind: 'none' })
    expect(resolveAgentReviewBreachHandling(undefined)).toEqual({ kind: 'none' })
  })

  test('the breach vocabulary cannot express a route or a verdict', () => {
    // The guarantee that a deadline never disposes a proposal is STRUCTURAL:
    // there is no action a definition could author that would reach one.
    expect(agentReviewOnBreachSchema.safeParse({ action: 'route' }).success).toBe(false)
    expect(agentReviewOnBreachSchema.safeParse({ action: 'reject' }).success).toBe(false)
    expect(agentReviewOnBreachSchema.safeParse({ action: 'approve' }).success).toBe(false)
    expect(resolveAgentReviewBreachHandling({ action: 'route' } as never)).toEqual({ kind: 'none' })
  })
})
