import { planSteps, WAIT_STEP_TYPE } from '../chain-planner'
import type { CampaignStep } from '../types'

const action = (id: string, type = 'add_tag'): CampaignStep => ({ id, type, params: {} })
const wait = (id: string, minutes: unknown): CampaignStep => ({ id, type: WAIT_STEP_TYPE, params: { minutes } })

describe('planSteps', () => {
  test('plans every step when there is no wait', () => {
    const steps = [action('a'), action('b'), action('c')]
    expect(planSteps(steps)).toEqual([
      { kind: 'run', index: 0, step: steps[0] },
      { kind: 'run', index: 1, step: steps[1] },
      { kind: 'run', index: 2, step: steps[2] },
    ])
  })

  // A wait parks the whole remainder: anything after it must be absent from the plan, not
  // merely marked. This is the property the executor relies on to know it can stop.
  test('stops at the first wait and omits everything after it', () => {
    const steps = [action('a'), wait('w', 60), action('b'), action('c')]
    const plan = planSteps(steps)
    expect(plan).toEqual([
      { kind: 'run', index: 0, step: steps[0] },
      { kind: 'pause', index: 1, resumeIndex: 2, minutes: 60 },
    ])
  })

  test('resumes after the wait rather than re-running it', () => {
    const steps = [action('a'), wait('w', 60), action('b')]
    const { resumeIndex } = planSteps(steps)[1] as { resumeIndex: number }
    expect(planSteps(steps, resumeIndex)).toEqual([{ kind: 'run', index: 2, step: steps[2] }])
  })

  test('pauses again at a second wait', () => {
    const steps = [wait('w1', 5), action('a'), wait('w2', 10), action('b')]
    expect(planSteps(steps, 1)).toEqual([
      { kind: 'run', index: 1, step: steps[1] },
      { kind: 'pause', index: 2, resumeIndex: 3, minutes: 10 },
    ])
  })

  test('a leading wait parks immediately with nothing run', () => {
    expect(planSteps([wait('w', 30), action('a')])).toEqual([
      { kind: 'pause', index: 0, resumeIndex: 1, minutes: 30 },
    ])
  })

  test.each([[0], [-5], ['nonsense'], [null], [undefined]])(
    'a wait of %p is a no-op rather than a park',
    (minutes) => {
      const steps = [wait('w', minutes), action('a')]
      expect(planSteps(steps)).toEqual([{ kind: 'run', index: 1, step: steps[1] }])
    },
  )

  test('an unknown step type is still planned as run', () => {
    const steps: CampaignStep[] = [{ id: 'x', type: 'from_a_disabled_module', params: {} }]
    expect(planSteps(steps)).toEqual([{ kind: 'run', index: 0, step: steps[0] }])
  })

  test('an empty step list plans nothing', () => {
    expect(planSteps([])).toEqual([])
  })

  test('a start index past the end plans nothing', () => {
    expect(planSteps([action('a')], 5)).toEqual([])
  })
})
