/**
 * SLA-breach routing (spec §6.1 §4).
 *
 * The resolver is the single decision point for a breached task, shaped like
 * `resolveStepFailureHandling`. The regression that matters most is the last
 * describe block: a definition carrying no breach config resolves to `none`,
 * which is byte-for-byte the behavior before this feature existed.
 */

import { describe, test, expect } from '@jest/globals'
import {
  SLA_BREACH_TRANSITION_KIND,
  excludeSlaBreachTransitions,
  findSlaBreachTransition,
  isSlaBreachTransition,
  resolveBreachReassignTarget,
  resolveTaskBreachHandling,
} from '../breach-routing'
import { workflowTransitionSchema } from '../../data/validators'

const normalRoute = {
  transitionId: 't_approved',
  fromStepId: 'review',
  toStepId: 'fulfil',
  trigger: 'auto' as const,
  priority: 0,
}

const breachRoute = {
  transitionId: 't_breach',
  fromStepId: 'review',
  toStepId: 'escalation',
  trigger: 'auto' as const,
  kind: SLA_BREACH_TRANSITION_KIND,
  priority: 0,
}

const definition = { transitions: [normalRoute, breachRoute] }

describe('SLA-breach transitions are invisible to normal routing', () => {
  test('the discriminator is the additive kind field', () => {
    expect(isSlaBreachTransition(breachRoute)).toBe(true)
    expect(isSlaBreachTransition(normalRoute)).toBe(false)
    expect(isSlaBreachTransition({ kind: 'error' })).toBe(false)
    expect(isSlaBreachTransition(null)).toBe(false)
  })

  test('normal routing never sees a breach route', () => {
    expect(excludeSlaBreachTransitions(definition.transitions)).toEqual([normalRoute])
  })

  test('the schema accepts the new kind and still accepts the old ones', () => {
    expect(workflowTransitionSchema.safeParse(breachRoute).success).toBe(true)
    expect(
      workflowTransitionSchema.safeParse({ ...normalRoute, kind: 'error' }).success
    ).toBe(true)
    expect(workflowTransitionSchema.safeParse(normalRoute).success).toBe(true)
  })
})

describe('findSlaBreachTransition', () => {
  test('picks the highest-priority outgoing breach route', () => {
    const higher = { ...breachRoute, transitionId: 't_breach_2', priority: 5 }
    const found = findSlaBreachTransition(
      { transitions: [breachRoute, higher] },
      'review'
    )
    expect(found?.transitionId).toBe('t_breach_2')
  })

  test('a breach route leaving another step belongs to that step', () => {
    expect(
      findSlaBreachTransition({ transitions: [{ ...breachRoute, fromStepId: 'other' }] }, 'review')
    ).toBeNull()
  })
})

describe('resolveTaskBreachHandling', () => {
  test('a wired breach route wins over the authored onBreach action', () => {
    const handling = resolveTaskBreachHandling(definition, 'review', { action: 'notify' })
    expect(handling).toEqual({ kind: 'route', transition: breachRoute })
  })

  test('an unwired breach falls back to the step onBreach route binding', () => {
    const handling = resolveTaskBreachHandling(
      { transitions: [normalRoute] },
      'review',
      { action: 'route', transitionId: 't_approved' }
    )
    expect(handling).toEqual({ kind: 'route', transition: normalRoute })
  })

  test('a route binding whose transition no longer leaves this step fails safe to none', () => {
    expect(
      resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', {
        action: 'route',
        transitionId: 't_gone',
      })
    ).toEqual({ kind: 'none' })

    expect(
      resolveTaskBreachHandling(
        { transitions: [{ ...normalRoute, fromStepId: 'somewhere_else' }] },
        'review',
        { action: 'route', transitionId: 't_approved' }
      )
    ).toEqual({ kind: 'none' })
  })

  test('falls back to reassign when that is the authored action', () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    expect(
      resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', {
        action: 'reassign',
        reassignTo: userId,
      })
    ).toEqual({ kind: 'reassign', assignedTo: userId, assignedToRoles: null })

    expect(
      resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', {
        action: 'reassign',
        reassignTo: 'supervisors',
      })
    ).toEqual({ kind: 'reassign', assignedTo: null, assignedToRoles: ['supervisors'] })
  })

  test('reassign without a target fails safe to none', () => {
    expect(
      resolveTaskBreachHandling({ transitions: [] }, 'review', { action: 'reassign' })
    ).toEqual({ kind: 'none' })
  })

  test('falls back to notify when that is the authored action', () => {
    expect(
      resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', { action: 'notify' })
    ).toEqual({ kind: 'notify' })
  })
})

describe('regression: a task with no onBreach behaves exactly as before', () => {
  test('no onBreach and no breach route resolves to none', () => {
    expect(resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', null)).toEqual({
      kind: 'none',
    })
    expect(resolveTaskBreachHandling({ transitions: [normalRoute] }, 'review', undefined)).toEqual({
      kind: 'none',
    })
  })

  test('a definition with no transitions at all resolves to none', () => {
    expect(resolveTaskBreachHandling(null, 'review', null)).toEqual({ kind: 'none' })
    expect(resolveTaskBreachHandling({}, 'review', null)).toEqual({ kind: 'none' })
  })

  test('a legacy definition is unchanged by the breach filter', () => {
    const legacy = [normalRoute, { ...normalRoute, transitionId: 't_rejected', toStepId: 'reject' }]
    expect(excludeSlaBreachTransitions(legacy)).toEqual(legacy)
  })
})

describe('resolveBreachReassignTarget', () => {
  test('a uuid addresses one person, anything else a role queue', () => {
    expect(resolveBreachReassignTarget('22222222-2222-4222-8222-222222222222')).toEqual({
      assignedTo: '22222222-2222-4222-8222-222222222222',
      assignedToRoles: null,
    })
    expect(resolveBreachReassignTarget('  Supervisors  ')).toEqual({
      assignedTo: null,
      assignedToRoles: ['Supervisors'],
    })
  })

  test('an empty target is no target', () => {
    expect(resolveBreachReassignTarget('   ')).toBeNull()
    expect(resolveBreachReassignTarget(null)).toBeNull()
    expect(resolveBreachReassignTarget(undefined)).toBeNull()
  })
})
