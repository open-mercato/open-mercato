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
