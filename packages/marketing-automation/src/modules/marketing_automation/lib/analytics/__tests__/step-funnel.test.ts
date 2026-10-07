import { buildStepFunnel, describeJourney } from '../step-funnel'
import type { CampaignStep } from '../../engine/types'

const email = (id: string): CampaignStep => ({ id, type: 'send_email', params: {} })
const wait = (id: string): CampaignStep => ({ id, type: 'wait', params: { minutes: 60 } })
const split = (id: string, lanes: Array<{ key: string; steps: CampaignStep[] }>): CampaignStep => ({
  id,
  type: 'split',
  params: { variants: lanes.map((lane) => ({ key: lane.key, weight: 1, steps: lane.steps })) },
})

const counts = (entries: Array<[string, number, number?, number?, number?]>) => new Map(
  entries.map(([stepId, people, done, skipped, failed]) => [stepId, {
    step_id: stepId,
    people,
    done: done ?? people,
    skipped: skipped ?? 0,
    failed: failed ?? 0,
  }]),
)

describe('describeJourney', () => {
  it('walks the trunk in order, each step measured against the one before it', () => {
    const positions = describeJourney([email('s1'), wait('s2'), email('s3')])
    expect(positions.map((position) => [position.stepId, position.previousStepId])).toEqual([
      ['s1', null],
      ['s2', 's1'],
      ['s3', 's2'],
    ])
  })

  /**
   * The decision this walk exists to get right.
   *
   * Only a share of the people who reach a split enter each lane, so a lane step measured against the step
   * BEFORE the split would report the split's own weights as a drop-off — every A/B test would read as a
   * catastrophe on the screen that is supposed to evaluate it.
   */
  it('measures a lane step against the split, not against the trunk before it', () => {
    const positions = describeJourney([
      email('s1'),
      split('sp1', [{ key: 'a', steps: [email('a1'), email('a2')] }, { key: 'b', steps: [email('b1')] }]),
    ])
    const byId = new Map(positions.map((position) => [position.stepId, position]))
    expect(byId.get('a1')).toMatchObject({ previousStepId: 'sp1', variantKey: 'a' })
    expect(byId.get('a2')).toMatchObject({ previousStepId: 'a1', variantKey: 'a' })
    expect(byId.get('b1')).toMatchObject({ previousStepId: 'sp1', variantKey: 'b' })
    // The trunk keeps its own lineage: the split's predecessor is the step before it.
    expect(byId.get('sp1')).toMatchObject({ previousStepId: 's1', variantKey: null })
  })

  /**
   * And the other side of the same problem.
   *
   * Which lane a given person walked is path-dependent, so a step after the split cannot be measured against
   * one lane's last step. The split is the last point every one of them shared.
   */
  it('measures a step after a split against the split as well', () => {
    const positions = describeJourney([
      split('sp1', [{ key: 'a', steps: [email('a1')] }, { key: 'b', steps: [email('b1')] }]),
      email('s2'),
    ])
    expect(positions.find((position) => position.stepId === 's2')?.previousStepId).toBe('sp1')
  })

  it('descends into lanes at all, which is the rule every walk in this module obeys', () => {
    const positions = describeJourney([split('sp1', [{ key: 'a', steps: [email('a1')] }])])
    expect(positions.map((position) => position.stepId)).toContain('a1')
  })
})

describe('buildStepFunnel', () => {
  it('reports the drop-off between consecutive steps and the share of the first', () => {
    const funnel = buildStepFunnel(
      describeJourney([email('s1'), wait('s2'), email('s3')]),
      counts([['s1', 100], ['s2', 80], ['s3', 40]]),
    )
    expect(funnel[0]).toMatchObject({ people: 100, reachedFromPrevious: null, shareOfFirst: 1 })
    expect(funnel[1]).toMatchObject({ people: 80, reachedFromPrevious: 0.8, shareOfFirst: 0.8 })
    expect(funnel[2]).toMatchObject({ people: 40, reachedFromPrevious: 0.5, shareOfFirst: 0.4 })
  })

  /** A step nobody has reached is a zero that is reported, not a row that is missing. */
  it('reports a step with no counts as zero rather than omitting it', () => {
    const funnel = buildStepFunnel(describeJourney([email('s1'), email('s2')]), counts([['s1', 10]]))
    expect(funnel).toHaveLength(2)
    expect(funnel[1]).toMatchObject({ stepId: 's2', people: 0, reachedFromPrevious: 0 })
  })

  /** A rate over nobody is not a rate of nothing. */
  it('reports a null rate when the predecessor is empty', () => {
    const funnel = buildStepFunnel(describeJourney([email('s1'), email('s2')]), counts([]))
    expect(funnel[1].reachedFromPrevious).toBeNull()
    expect(funnel[0].shareOfFirst).toBeNull()
  })

  it('carries the outcome breakdown, because a skip and a failure are different problems', () => {
    const funnel = buildStepFunnel(describeJourney([email('s1')]), counts([['s1', 10, 7, 2, 1]]))
    expect(funnel[0]).toMatchObject({ done: 7, skipped: 2, failed: 1 })
  })

  it('answers nothing for a campaign with no steps', () => {
    expect(buildStepFunnel(describeJourney([]), counts([]))).toEqual([])
  })
})

/**
 * The split's own count, which nothing could supply until it was read from the right place.
 *
 * `flattenSteps` replaces a split with the chosen lane's steps and never plans the split itself, so no
 * `stepLog` entry ever carries its id — and every count above is derived from that log. So every split read
 * zero, and since the split is the `previousStepId` of both its lanes AND of whatever follows them, the
 * conversion into each was `ratio(x, 0)` — null. A campaign starting with a split had a null share for its
 * whole journey.
 *
 * The reach was recorded all along, on `marketing_campaign_runs.variant_choices`, one key per split the
 * subject passed. `loadStepFunnel` now reads it and merges it in; these tests cover the shape that merge
 * produces, which is what the screen renders.
 */
describe('a journey with a split', () => {
  const journey = [split('sp1', [
    { key: 'a', steps: [email('a1')] },
    { key: 'b', steps: [email('b1')] },
  ]), email('after')]

  it('was unanswerable without the split count, and is not a zero', () => {
    // What the screen showed before: the split at zero drags every conversion after it to null.
    const broken = buildStepFunnel(describeJourney(journey), counts([['a1', 6], ['b1', 4], ['after', 9]]))
    expect(broken.find((step) => step.stepId === 'sp1')?.people).toBe(0)
    expect(broken.find((step) => step.stepId === 'a1')?.reachedFromPrevious).toBeNull()
    expect(broken.find((step) => step.stepId === 'after')?.reachedFromPrevious).toBeNull()
  })

  it('reads as a journey once the split carries its reach', () => {
    const funnel = buildStepFunnel(
      describeJourney(journey),
      counts([['sp1', 10], ['a1', 6], ['b1', 4], ['after', 9]]),
    )
    expect(funnel.find((step) => step.stepId === 'sp1')?.people).toBe(10)
    // Six of the ten went down lane a, four down lane b — and both are measured against the split, not
    // against each other or against the first step.
    expect(funnel.find((step) => step.stepId === 'a1')?.reachedFromPrevious).toBeCloseTo(0.6)
    expect(funnel.find((step) => step.stepId === 'b1')?.reachedFromPrevious).toBeCloseTo(0.4)
    // And the trunk step after the split is measured against the split too, because that is where the
    // lanes rejoin — nine of the ten got past it.
    expect(funnel.find((step) => step.stepId === 'after')?.reachedFromPrevious).toBeCloseTo(0.9)
  })
})
