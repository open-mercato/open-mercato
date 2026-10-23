import {
  addVariant,
  appendStep,
  collectStepIds,
  locateStep,
  moveStep,
  removeStep,
  removeVariant,
  updateStepParams,
  updateVariant,
} from '../step-tree'
import { makeSplitStep, readVariants } from '../../engine/split'
import type { CampaignStep } from '../../engine/types'

const step = (id: string, type = 'add_tag'): CampaignStep => ({ id, type, params: {} })

function splitWith(id: string, lanes: Record<string, CampaignStep[]>): CampaignStep {
  return {
    id,
    type: 'split',
    params: {
      variants: Object.entries(lanes).map(([key, steps]) => ({ key, weight: 1, steps })),
    },
  }
}

const tree = (): CampaignStep[] => [
  step('trunk-1'),
  splitWith('split-1', { a: [step('a-1'), step('a-2')], b: [step('b-1')] }),
  step('trunk-2'),
]

describe('locateStep', () => {
  test('finds a top-level step with its position in the trunk', () => {
    expect(locateStep(tree(), 'trunk-2')).toMatchObject({ index: 2, siblingCount: 3, lane: null })
  })

  test('finds a step inside a lane and reports which lane owns it', () => {
    expect(locateStep(tree(), 'a-2')).toMatchObject({
      index: 1,
      siblingCount: 2,
      lane: { splitId: 'split-1', laneKey: 'a' },
    })
  })

  test('returns null for an unknown id', () => {
    expect(locateStep(tree(), 'nope')).toBeNull()
  })

  test('finds a step nested two splits deep', () => {
    const inner = splitWith('split-2', { x: [step('deep')] })
    const steps = [splitWith('split-1', { a: [inner] })]
    expect(locateStep(steps, 'deep')?.lane).toEqual({ splitId: 'split-2', laneKey: 'x' })
  })
})

describe('updateStepParams', () => {
  test('updates a step inside a lane without disturbing the rest of the tree', () => {
    const next = updateStepParams(tree(), 'b-1', { tagId: 'vip' })
    expect(locateStep(next, 'b-1')?.step.params).toEqual({ tagId: 'vip' })
    expect(locateStep(next, 'a-1')?.step.params).toEqual({})
    expect(collectStepIds(next)).toEqual(collectStepIds(tree()))
  })

  test('leaves the input untouched', () => {
    const original = tree()
    updateStepParams(original, 'a-1', { tagId: 'vip' })
    expect(locateStep(original, 'a-1')?.step.params).toEqual({})
  })
})

describe('removeStep', () => {
  test('removes a lane step and keeps the lane', () => {
    const next = removeStep(tree(), 'a-1')
    expect(locateStep(next, 'a-1')).toBeNull()
    expect(locateStep(next, 'a-2')?.lane).toEqual({ splitId: 'split-1', laneKey: 'a' })
  })

  test('removing a split removes everything authored inside it', () => {
    const next = removeStep(tree(), 'split-1')
    expect(collectStepIds(next)).toEqual(['trunk-1', 'trunk-2'])
  })
})

describe('moveStep', () => {
  test('reorders within a lane', () => {
    const next = moveStep(tree(), 'a-2', -1)
    expect(readVariants(locateStep(next, 'split-1')!.step)[0].steps.map((entry) => entry.id)).toEqual(['a-2', 'a-1'])
  })

  // A step must not escape its lane by being moved: the lane is a different chain, and a step that
  // jumped out of it would silently start running for every subject instead of half of them.
  test('a step at the edge of its lane does not move into the trunk', () => {
    const next = moveStep(tree(), 'a-1', -1)
    expect(locateStep(next, 'a-1')).toMatchObject({ index: 0, lane: { splitId: 'split-1', laneKey: 'a' } })
    expect(collectStepIds(next)).toEqual(collectStepIds(tree()))
  })

  test('reorders in the trunk', () => {
    const next = moveStep(tree(), 'trunk-2', -1)
    expect(next.map((entry) => entry.id)).toEqual(['trunk-1', 'trunk-2', 'split-1'])
  })
})

describe('appendStep', () => {
  test('appends to the trunk when no lane is given', () => {
    const next = appendStep(tree(), step('new'), null)
    expect(next[next.length - 1].id).toBe('new')
  })

  test('appends into the named lane', () => {
    const next = appendStep(tree(), step('new'), { splitId: 'split-1', laneKey: 'b' })
    expect(locateStep(next, 'new')?.lane).toEqual({ splitId: 'split-1', laneKey: 'b' })
    expect(readVariants(locateStep(next, 'split-1')!.step)[0].steps.map((entry) => entry.id)).toEqual(['a-1', 'a-2'])
  })

  test('an unknown lane changes nothing', () => {
    const next = appendStep(tree(), step('new'), { splitId: 'split-1', laneKey: 'zzz' })
    expect(collectStepIds(next)).toEqual(collectStepIds(tree()))
  })
})

describe('variant editing', () => {
  test('a new split starts with the two lanes its schema requires', () => {
    expect(readVariants(makeSplitStep('s')).map((variant) => variant.key)).toEqual(['a', 'b'])
  })

  test('addVariant takes the first free letter', () => {
    const next = addVariant(tree(), 'split-1')
    expect(readVariants(locateStep(next, 'split-1')!.step).map((variant) => variant.key)).toEqual(['a', 'b', 'c'])
  })

  test('renaming a lane keeps its steps and its order', () => {
    const next = updateVariant(tree(), 'split-1', 'a', { key: 'control' })
    const variants = readVariants(locateStep(next, 'split-1')!.step)
    expect(variants[0].key).toBe('control')
    expect(variants[0].steps.map((entry) => entry.id)).toEqual(['a-1', 'a-2'])
  })

  // Every one of these inputs would make `readVariants` drop the lane on the next render, taking the
  // steps inside it with it — while the author was only halfway through typing.
  test.each([
    ['an empty key', { key: '' }],
    ['a blank key', { key: '   ' }],
    ['a key that another lane already uses', { key: 'b' }],
    ['a zero weight', { weight: 0 }],
    ['a negative weight', { weight: -1 }],
    ['a weight that is not a number', { weight: Number.NaN }],
  ])('rejects %s', (_label, patch) => {
    const next = updateVariant(tree(), 'split-1', 'a', patch)
    expect(readVariants(locateStep(next, 'split-1')!.step)).toEqual(readVariants(locateStep(tree(), 'split-1')!.step))
  })

  test('accepts a fractional weight', () => {
    const next = updateVariant(tree(), 'split-1', 'a', { weight: 0.25 })
    expect(readVariants(locateStep(next, 'split-1')!.step)[0].weight).toBe(0.25)
  })

  test('removeVariant drops the lane and its steps', () => {
    const next = removeVariant(tree(), 'split-1', 'a')
    expect(collectStepIds(next)).toEqual(['trunk-1', 'split-1', 'b-1', 'trunk-2'])
  })
})

describe('collectStepIds', () => {
  test('includes lane steps, which is what stops deleted nodes leaving stale positions behind', () => {
    expect(collectStepIds(tree())).toEqual(['trunk-1', 'split-1', 'a-1', 'a-2', 'b-1', 'trunk-2'])
  })
})
