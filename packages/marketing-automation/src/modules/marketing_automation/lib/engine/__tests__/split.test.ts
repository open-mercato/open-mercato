import { describeVariantChoices, flattenSteps, readVariants, resolveResumeIndex, selectVariant, SPLIT_STEP_TYPE } from '../split'
import type { CampaignStep } from '../types'

const action = (id: string, type = 'add_tag'): CampaignStep => ({ id, type, params: {} })
const wait = (id: string, minutes = 60): CampaignStep => ({ id, type: 'wait', params: { minutes } })
const split = (id: string, variants: unknown): CampaignStep => ({ id, type: SPLIT_STEP_TYPE, params: { variants } })

const twoLanes = (id: string) => split(id, [
  { key: 'a', weight: 1, steps: [action(`${id}-a`)] },
  { key: 'b', weight: 1, steps: [action(`${id}-b`)] },
])

describe('selectVariant — stability', () => {
  // THE property the whole design rests on. A run that pauses inside a lane and resumes an hour
  // later must come back to the same lane, or the customer receives a mixture of both variants and
  // the test measures nothing. Stability is by construction here, so this asserts it directly.
  test('the same subject always lands in the same lane', () => {
    const step = twoLanes('s')
    const first = selectVariant(step, 'customer-1')?.key
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(selectVariant(step, 'customer-1')?.key).toBe(first)
    }
  })

  test('the choice depends on the step, so two splits can disagree for one subject', () => {
    const keys = new Set<string | undefined>()
    for (const id of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      keys.add(selectVariant(twoLanes(id), 'customer-1')?.key)
    }
    expect(keys.size).toBe(2)
  })

  test('different subjects are spread across the lanes', () => {
    const step = twoLanes('s')
    const counts = { a: 0, b: 0 }
    for (let index = 0; index < 400; index += 1) {
      const key = selectVariant(step, `customer-${index}`)?.key as 'a' | 'b'
      counts[key] += 1
    }
    // A generous band: this asserts the hash spreads at all, not that it is a perfect PRNG.
    expect(counts.a).toBeGreaterThan(120)
    expect(counts.b).toBeGreaterThan(120)
  })

  test('weights shift the distribution', () => {
    const weighted = split('s', [
      { key: 'big', weight: 9, steps: [] },
      { key: 'small', weight: 1, steps: [] },
    ])
    let big = 0
    for (let index = 0; index < 400; index += 1) {
      if (selectVariant(weighted, `customer-${index}`)?.key === 'big') big += 1
    }
    expect(big).toBeGreaterThan(300)
  })
})

describe('readVariants — malformed lanes', () => {
  test('drops lanes without a key or with a non-positive weight', () => {
    const step = split('s', [
      { key: 'ok', weight: 1, steps: [] },
      { key: '', weight: 1, steps: [] },
      { weight: 1, steps: [] },
      { key: 'zero', weight: 0, steps: [] },
      { key: 'negative', weight: -2, steps: [] },
      'nonsense',
      null,
    ])
    expect(readVariants(step).map((variant) => variant.key)).toEqual(['ok'])
  })

  test('drops step entries that are not steps', () => {
    const step = split('s', [{ key: 'a', weight: 1, steps: [action('x'), 42, { type: 'no-id' }, null] }])
    expect(readVariants(step)[0].steps.map((entry) => entry.id)).toEqual(['x'])
  })

  test('a split with no usable lane selects nothing', () => {
    expect(selectVariant(split('s', []), 'c')).toBeNull()
    expect(selectVariant(split('s', 'garbage'), 'c')).toBeNull()
  })
})

describe('flattenSteps', () => {
  test('a chain without splits is unchanged', () => {
    const steps = [action('a'), wait('w'), action('b')]
    expect(flattenSteps(steps, 'c').map((step) => step.id)).toEqual(['a', 'w', 'b'])
  })

  // A split is a detour, not a terminus: the shared follow-up after the branch is what makes an A/B
  // test usable rather than forcing the author to duplicate every later step into both lanes.
  test('the chosen lane runs in place and the outer chain continues', () => {
    const steps = [action('before'), twoLanes('s'), action('after')]
    const flattened = flattenSteps(steps, 'customer-1').map((step) => step.id)
    expect(flattened[0]).toBe('before')
    expect(flattened[flattened.length - 1]).toBe('after')
    expect(flattened).toHaveLength(3)
    expect(['s-a', 's-b']).toContain(flattened[1])
  })

  test('only one lane is ever present', () => {
    const steps = [twoLanes('s')]
    for (let index = 0; index < 20; index += 1) {
      const ids = flattenSteps(steps, `customer-${index}`).map((step) => step.id)
      expect(ids).toHaveLength(1)
      expect(ids.includes('s-a') && ids.includes('s-b')).toBe(false)
    }
  })

  test('flattening is reproducible, which is what makes a resume land in the same lane', () => {
    const steps = [action('before'), twoLanes('s'), action('after')]
    const first = flattenSteps(steps, 'customer-7').map((step) => step.id)
    expect(flattenSteps(steps, 'customer-7').map((step) => step.id)).toEqual(first)
  })

  test('descends into a nested split', () => {
    const inner = twoLanes('inner')
    const outer = split('outer', [{ key: 'only', weight: 1, steps: [action('x'), inner] }])
    const ids = flattenSteps([outer], 'customer-1').map((step) => step.id)
    expect(ids[0]).toBe('x')
    expect(['inner-a', 'inner-b']).toContain(ids[1])
    expect(ids).toHaveLength(2)
  })

  test('a split with no usable lane contributes nothing but does not break the chain', () => {
    const steps = [action('a'), split('s', []), action('b')]
    expect(flattenSteps(steps, 'c').map((step) => step.id)).toEqual(['a', 'b'])
  })

  test('nesting past the cap truncates rather than recursing without bound', () => {
    let nested: CampaignStep = action('leaf')
    for (let level = 0; level < 9; level += 1) {
      nested = split(`level-${level}`, [{ key: 'only', weight: 1, steps: [nested] }])
    }
    expect(() => flattenSteps([nested], 'c')).not.toThrow()
    expect(flattenSteps([nested], 'c').length).toBe(0)
  })
})

describe('describeVariantChoices', () => {
  test('reports the lane each split assigned, including nested ones', () => {
    const inner = twoLanes('inner')
    const outer = split('outer', [{ key: 'only', weight: 1, steps: [inner] }])
    const choices = describeVariantChoices([outer], 'customer-1')
    expect(choices.outer).toBe('only')
    expect(['a', 'b']).toContain(choices.inner)
  })

  test('agrees with what the flattening actually produced', () => {
    const steps = [twoLanes('s')]
    for (let index = 0; index < 10; index += 1) {
      const subject = `customer-${index}`
      const chosen = describeVariantChoices(steps, subject).s
      expect(flattenSteps(steps, subject)[0].id).toBe(`s-${chosen}`)
    }
  })
})

// The split is A/B/X, not A/B: nothing in the model is limited to two lanes, and a holdout is just a
// lane with no steps. Both are asserted because both are things an author will reach for on day one.
describe('more than two lanes', () => {
  const manyLanes = (weights: Record<string, number>) => split('s', Object.entries(weights).map(([key, weight]) => ({
    key,
    weight,
    steps: [action(`s-${key}`)],
  })))

  test('three lanes each receive subjects, in roughly their declared shares', () => {
    const step = manyLanes({ a: 2, b: 1, c: 1 })
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let index = 0; index < 800; index += 1) {
      counts[selectVariant(step, `customer-${index}`)!.key] += 1
    }
    expect(counts.a).toBeGreaterThan(counts.b)
    expect(counts.a).toBeGreaterThan(counts.c)
    expect(counts.b).toBeGreaterThan(100)
    expect(counts.c).toBeGreaterThan(100)
    expect(counts.a + counts.b + counts.c).toBe(800)
  })

  test('six lanes are all reachable', () => {
    const step = manyLanes({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 })
    const seen = new Set<string>()
    for (let index = 0; index < 600; index += 1) {
      seen.add(selectVariant(step, `customer-${index}`)!.key)
    }
    expect(seen.size).toBe(6)
  })

  test('each lane contributes only its own steps', () => {
    const step = manyLanes({ a: 1, b: 1, c: 1 })
    for (let index = 0; index < 60; index += 1) {
      const subject = `customer-${index}`
      const chosen = selectVariant(step, subject)!.key
      expect(flattenSteps([step], subject).map((entry) => entry.id)).toEqual([`s-${chosen}`])
    }
  })

  // A holdout: one lane deliberately does nothing, so its subjects skip the tested message and are
  // measured against the ones who received it. The shared follow-up still runs for everybody.
  test('an empty lane is a holdout that still reaches the shared follow-up', () => {
    const step = split('s', [
      { key: 'treatment', weight: 1, steps: [action('email')] },
      { key: 'holdout', weight: 1, steps: [] },
    ])
    const steps = [step, action('after')]
    const holdouts = []
    const treated = []
    for (let index = 0; index < 120; index += 1) {
      const subject = `customer-${index}`
      const ids = flattenSteps(steps, subject).map((entry) => entry.id)
      if (selectVariant(step, subject)!.key === 'holdout') holdouts.push(ids)
      else treated.push(ids)
    }
    expect(holdouts.length).toBeGreaterThan(0)
    expect(treated.length).toBeGreaterThan(0)
    expect(holdouts.every((ids) => ids.join() === 'after')).toBe(true)
    expect(treated.every((ids) => ids.join() === 'email,after')).toBe(true)
  })
})

/**
 * Where a parked run picks up once the definition it parked in has been edited.
 *
 * The lane choice is stable, so the tests above hold for an UNCHANGED campaign. They say nothing about
 * an edited one, and `current_step_index` indexes into the array `flattenSteps` returns now: after a
 * save, an A/B promotion, a reorder or a delete, the same position is a different step.
 */
describe('resolveResumeIndex', () => {
  test('finds the step by id wherever it has moved to', () => {
    const steps = [action('a'), action('b'), action('c')]
    // Parked at 'c', which was index 2 and is now index 0.
    expect(resolveResumeIndex([action('c'), action('a'), action('b')], 'c', 2)).toBe(0)
  })

  test('a step inserted before the parked one does not re-send it', () => {
    const parked = [action('welcome'), wait('w'), action('offer')]
    expect(resolveResumeIndex(parked, 'offer', 2)).toBe(2)
    const withInsert = [action('welcome'), action('extra'), wait('w'), action('offer')]
    // The index would have pointed at the wait, running the offer a second time afterwards.
    expect(resolveResumeIndex(withInsert, 'offer', 2)).toBe(3)
  })

  /**
   * The variant mixture, which is the defect this exists to stop.
   *
   * A promotion replaces the split with the winning lane's steps, so a subject parked at lane B's step
   * has a definition that no longer contains it. Resuming on the index would run lane A's step at the
   * same position and deliver a mixture of both variants.
   */
  test('refuses to resume when the parked step is gone, rather than guessing a position', () => {
    const promotedToLaneA = flattenSteps([action('before'), twoLanes('s'), action('after')], 'customer-1')
    const parkedInTheOtherLane = promotedToLaneA[1].id === 's-a' ? 's-b' : 's-a'
    expect(resolveResumeIndex(promotedToLaneA, parkedInTheOtherLane, 1)).toBeNull()
  })

  test('a run parked past the new end is refused too, not silently completed at the old index', () => {
    expect(resolveResumeIndex([action('a')], 'c', 2)).toBeNull()
  })

  /** Runs that parked before the column existed have only the index, which is the old behaviour. */
  test('falls back to the index when no id was recorded', () => {
    const steps = [action('a'), action('b'), action('c')]
    expect(resolveResumeIndex(steps, null, 1)).toBe(1)
    expect(resolveResumeIndex(steps, undefined, 2)).toBe(2)
  })
})
