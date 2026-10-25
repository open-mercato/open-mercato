import { assertNoLoopRisk, assertStepIdsAreUnique, collectEmittedEvents } from '../campaigns'

type Step = { id: string; type: string; params: Record<string, unknown> }

const step = (id: string, type: string): Step => ({ id, type, params: {} })
const split = (id: string, lanes: Record<string, Step[]>): Step => ({
  id,
  type: 'split',
  params: { variants: Object.entries(lanes).map(([key, steps]) => ({ key, weight: 1, steps })) },
})

/**
 * The cycle guard, with the case that shipped broken.
 *
 * Its two sibling assertions both recurse into a split's lanes; this one did not, so a campaign whose
 * `add_tag` sat inside a lane passed the check and then drove itself on every tag assignment, with only
 * the per-subject run budget braking it.
 */
describe('collectEmittedEvents', () => {
  test('finds an event a trunk step emits', () => {
    expect([...collectEmittedEvents([step('s1', 'add_tag')] as never)]).toEqual(['customers.tag.assigned'])
  })

  test('finds an event a step INSIDE A LANE emits', () => {
    const steps = [split('sp1', { a: [step('a1', 'add_tag')], b: [step('b1', 'send_email')] })]
    expect([...collectEmittedEvents(steps as never)]).toEqual(['customers.tag.assigned'])
  })

  test('finds one nested two splits deep', () => {
    const inner = split('sp2', { x: [step('x1', 'add_points')] })
    const steps = [split('sp1', { a: [inner] })]
    expect([...collectEmittedEvents(steps as never)]).toEqual(['marketing_automation.score.changed'])
  })

  test('collects from every lane, not just the first', () => {
    const steps = [split('sp1', { a: [step('a1', 'add_tag')], b: [step('b1', 'add_points')] })]
    expect([...collectEmittedEvents(steps as never)].sort())
      .toEqual(['customers.tag.assigned', 'marketing_automation.score.changed'])
  })

  test('a step that emits nothing contributes nothing', () => {
    expect([...collectEmittedEvents([step('s1', 'send_email'), step('w', 'wait')] as never)]).toEqual([])
  })
})

describe('assertNoLoopRisk', () => {
  test('refuses a campaign whose trunk step emits its own trigger', () => {
    expect(() => assertNoLoopRisk([step('s1', 'add_tag')] as never, ['customers.tag.assigned'])).toThrow()
  })

  // The case the trunk-only version let through.
  test('refuses a campaign whose LANE step emits its own trigger', () => {
    const steps = [split('sp1', { a: [step('a1', 'add_tag')], b: [step('b1', 'send_email')] })]
    expect(() => assertNoLoopRisk(steps as never, ['customers.tag.assigned'])).toThrow()
  })

  test('refuses a score campaign that awards points from inside a lane', () => {
    const steps = [split('sp1', { a: [step('a1', 'add_points')] })]
    expect(() => assertNoLoopRisk(steps as never, ['marketing_automation.score.changed'])).toThrow()
  })

  test('allows a campaign that emits an event it does not react to', () => {
    expect(() => assertNoLoopRisk([step('s1', 'add_tag')] as never, ['sales.order.created'])).not.toThrow()
  })

  test('allows a campaign with no triggers to check against', () => {
    expect(() => assertNoLoopRisk([step('s1', 'add_tag')] as never, [])).not.toThrow()
  })

  /**
   * The audience carve-out: a tag-triggered campaign may still tag its own subjects, as long as the
   * tag it adds is provably not the one its own audience requires on `trigger.tagId`.
   */
  const addTag = (id: string, tagId: string): Step => ({ id, type: 'add_tag', params: { tagId } })

  test('allows adding a DIFFERENT tag than the one the audience requires', () => {
    const audience = { field: 'trigger.tagId', operator: '==', value: 'vip' }
    expect(() => assertNoLoopRisk(
      [addTag('s1', 'bronze')] as never,
      ['customers.tag.assigned'],
      audience as never,
    )).not.toThrow()
  })

  test('still refuses adding the SAME tag the audience requires', () => {
    const audience = { field: 'trigger.tagId', operator: '==', value: 'vip' }
    expect(() => assertNoLoopRisk(
      [addTag('s1', 'vip')] as never,
      ['customers.tag.assigned'],
      audience as never,
    )).toThrow()
  })

  test('still refuses any add_tag step when the audience says nothing about the tag', () => {
    const audience = { field: 'customer.tier', operator: '==', value: 'gold' }
    expect(() => assertNoLoopRisk(
      [addTag('s1', 'bronze')] as never,
      ['customers.tag.assigned'],
      audience as never,
    )).toThrow()
  })

  test('still refuses when the audience ORs the tag check with an unconstrained branch', () => {
    const audience = {
      operator: 'OR',
      rules: [
        { field: 'trigger.tagId', operator: '==', value: 'vip' },
        { field: 'customer.tier', operator: '==', value: 'gold' },
      ],
    }
    expect(() => assertNoLoopRisk(
      [addTag('s1', 'bronze')] as never,
      ['customers.tag.assigned'],
      audience as never,
    )).toThrow()
  })

  test('allows a DIFFERENT tag when the audience ANDs the tag check with an unrelated condition', () => {
    const audience = {
      operator: 'AND',
      rules: [
        { field: 'trigger.tagId', operator: '==', value: 'vip' },
        { field: 'customer.tier', operator: '==', value: 'gold' },
      ],
    }
    expect(() => assertNoLoopRisk(
      [addTag('s1', 'bronze')] as never,
      ['customers.tag.assigned'],
      audience as never,
    )).not.toThrow()
  })
})

/**
 * Duplicate step ids, which silently disable the guards that key on them.
 *
 * The score ledger and the survey prompt both have a unique index on `(run_id, step_id)`, so two steps sharing an
 * id award points once and send one survey while reporting both as done — a campaign doing half of what it says,
 * with no error anywhere. Reachable through the API and through the AI authoring tool.
 */
describe('step ids', () => {
  const step = (id: string, type = 'add_points') => ({ id, type, params: { points: 1 } })

  test('two steps sharing an id are refused', () => {
    expect(() => assertStepIdsAreUnique([step('award'), step('award')] as never)).toThrow()
  })

  test('distinct ids are accepted', () => {
    expect(() => assertStepIdsAreUnique([step('award'), step('award-again')] as never)).not.toThrow()
  })

  /**
   * Into the lanes as well: a lane's steps are steps, and an id reused between a lane and the trunk is the same
   * collision. This module has shipped a trunk-only validation once before.
   */
  test('an id reused inside a split lane is refused', () => {
    const graph = [
      step('award'),
      {
        id: 'split',
        type: 'split',
        params: { variants: [{ key: 'a', weight: 1, steps: [step('award')] }] },
      },
    ]
    expect(() => assertStepIdsAreUnique(graph as never)).toThrow()
  })

  test('two lanes may each use their own ids', () => {
    const graph = [{
      id: 'split',
      type: 'split',
      params: {
        variants: [
          { key: 'a', weight: 1, steps: [step('a-award')] },
          { key: 'b', weight: 1, steps: [step('b-award')] },
        ],
      },
    }]
    expect(() => assertStepIdsAreUnique(graph as never)).not.toThrow()
  })
})
