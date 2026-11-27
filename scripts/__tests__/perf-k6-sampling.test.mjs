import test from 'node:test'
import assert from 'node:assert/strict'

import { createRng, hashSeed, pickDistinct, pickOne, randomInt } from '../../perf/k6/lib/pure/prng.js'
import { bucketPools, idOf, partitionSlice, pickBucket, pickWriteTarget, sampleEntity } from '../../perf/k6/lib/pure/sampling.js'
import { buildJourneyMix, normalizeWeights, pickJourney } from '../../perf/k6/lib/pure/weights.js'
import { thinkSeconds } from '../../perf/k6/lib/pure/misc.js'
import { DEFAULT_WORKLOAD } from '../../perf/k6/lib/pure/workload.js'

function tally(rng, draws, pick) {
  const counts = {}
  for (let index = 0; index < draws; index += 1) {
    const key = pick(rng)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

test('createRng is deterministic per seed and differs across seeds', () => {
  const first = createRng(hashSeed('42:vu:1'))
  const second = createRng(hashSeed('42:vu:1'))
  const other = createRng(hashSeed('42:vu:2'))
  const sequence = Array.from({ length: 5 }, () => first())
  assert.deepEqual(Array.from({ length: 5 }, () => second()), sequence)
  assert.notDeepEqual(Array.from({ length: 5 }, () => other()), sequence)
  for (const value of sequence) assert.ok(value >= 0 && value < 1)
})

test('randomInt stays inside inclusive bounds', () => {
  const rng = createRng(7)
  for (let index = 0; index < 1000; index += 1) {
    const value = randomInt(rng, 5, 9)
    assert.ok(value >= 5 && value <= 9)
  }
})

test('pickOne and pickDistinct accept array-like inputs', () => {
  const rng = createRng(3)
  const arrayLike = { length: 3, 0: 'a', 1: 'b', 2: 'c' }
  assert.ok(['a', 'b', 'c'].includes(pickOne(rng, arrayLike)))
  assert.equal(pickOne(rng, []), undefined)
  const distinct = pickDistinct(rng, ['a', 'b', 'c', 'd'], 3)
  assert.equal(distinct.length, 3)
  assert.equal(new Set(distinct).size, 3)
  assert.equal(pickDistinct(rng, ['a'], 4).length, 1)
})

test('bucket sampling follows the 80/15/5 weights within tolerance', () => {
  const pools = bucketPools({ light: ['l1', 'l2'], medium: ['m1'], heavy: ['h1'], extreme: ['x1'] })
  assert.deepEqual(pools.lightMedium, ['l1', 'l2', 'm1'])
  const draws = 20000
  const counts = tally(createRng(11), draws, (rng) => pickBucket(rng, DEFAULT_WORKLOAD.sampling.buckets, pools))
  assert.ok(Math.abs(counts.lightMedium / draws - 0.8) < 0.02)
  assert.ok(Math.abs(counts.heavy / draws - 0.15) < 0.02)
  assert.ok(Math.abs(counts.extreme / draws - 0.05) < 0.01)
})

test('sampleEntity skips empty buckets instead of returning nothing', () => {
  const pools = bucketPools({ light: ['l1'], medium: [], heavy: [], extreme: [] })
  const rng = createRng(5)
  for (let index = 0; index < 50; index += 1) {
    assert.deepEqual(sampleEntity(rng, pools), { bucket: 'lightMedium', id: 'l1' })
  }
  assert.equal(sampleEntity(rng, bucketPools({})), undefined)
})

test('idOf reads strings and id-bearing objects', () => {
  assert.equal(idOf('abc'), 'abc')
  assert.equal(idOf({ id: 'x' }), 'x')
  assert.equal(idOf({ userId: 'u' }), 'u')
  assert.equal(idOf(null), undefined)
})

test('partitionSlice gives disjoint partitions that cover the list', () => {
  const list = Array.from({ length: 23 }, (_unused, index) => `id${index}`)
  const partitions = Array.from({ length: 5 }, (_unused, index) => partitionSlice(list, index, 5))
  const flattened = partitions.flat()
  assert.equal(flattened.length, list.length)
  assert.equal(new Set(flattened).size, list.length)
  assert.deepEqual(partitionSlice(list, 7, 5), partitions[2])
  assert.deepEqual(partitionSlice(['only'], 3, 10), ['only'])
  assert.deepEqual(partitionSlice([], 0, 3), [])
})

test('pickWriteTarget sends about 10% of writes to the hot set', () => {
  const rng = createRng(21)
  const draws = 20000
  let hot = 0
  for (let index = 0; index < draws; index += 1) {
    const target = pickWriteTarget(rng, { partition: ['own1', 'own2'], hotSet: ['hot1'], hotShare: 0.1 })
    if (target.hot) {
      hot += 1
      assert.equal(target.id, 'hot1')
    } else {
      assert.ok(['own1', 'own2'].includes(target.id))
    }
  }
  assert.ok(Math.abs(hot / draws - 0.1) < 0.01)
  assert.deepEqual(pickWriteTarget(rng, { partition: [], hotSet: ['hot1'] }), { id: 'hot1', hot: true })
  assert.equal(pickWriteTarget(rng, { partition: [], hotSet: [] }), undefined)
})

test('normalizeWeights accepts maps and arrays and drops non-positive weights', () => {
  assert.deepEqual(normalizeWeights({ first: 3, second: 1, zero: 0 }), [
    { name: 'first', weight: 0.75 },
    { name: 'second', weight: 0.25 },
  ])
  assert.deepEqual(normalizeWeights([{ name: 'only', weight: 2 }]), [{ name: 'only', weight: 1 }])
  assert.deepEqual(normalizeWeights(null), [])
})

test('buildJourneyMix applies 70/20/10 group shares and per-journey weights', () => {
  const mix = buildJourneyMix(DEFAULT_WORKLOAD.groups)
  const share = (group) => mix.filter((entry) => entry.group === group).reduce((sum, entry) => sum + entry.weight, 0)
  assert.ok(Math.abs(share('read') - 0.7) < 1e-9)
  assert.ok(Math.abs(share('write') - 0.2) < 1e-9)
  assert.ok(Math.abs(share('heavy') - 0.1) < 1e-9)
  const peopleList = mix.find((entry) => entry.journey === 'people.list')
  assert.ok(Math.abs(peopleList.weight - 0.7 * (20 / 70)) < 1e-9)
  const interaction = mix.find((entry) => entry.journey === 'write.interaction')
  assert.ok(Math.abs(interaction.weight - 0.2 * (7 / 20)) < 1e-9)
})

test('buildJourneyMix renormalizes when a group is excluded', () => {
  const mix = buildJourneyMix(DEFAULT_WORKLOAD.groups, { excludeGroups: ['heavy'] })
  assert.equal(mix.some((entry) => entry.group === 'heavy'), false)
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
  const readShare = mix.filter((entry) => entry.group === 'read').reduce((sum, entry) => sum + entry.weight, 0)
  assert.ok(Math.abs(readShare - 70 / 90) < 1e-9)
})

test('buildJourneyMix drops journeys the runner does not know', () => {
  const mix = buildJourneyMix({ read: { share: 1, journeys: { known: 1, unknown: 3 } } }, { knownJourneys: ['known'] })
  assert.deepEqual(mix, [{ group: 'read', journey: 'known', weight: 1 }])
})

test('pickJourney draws journeys in proportion to their weights', () => {
  const mix = buildJourneyMix(DEFAULT_WORKLOAD.groups)
  const draws = 50000
  const counts = tally(createRng(99), draws, (rng) => pickJourney(rng, mix).group)
  assert.ok(Math.abs(counts.read / draws - 0.7) < 0.015)
  assert.ok(Math.abs(counts.write / draws - 0.2) < 0.015)
  assert.ok(Math.abs(counts.heavy / draws - 0.1) < 0.01)
})

test('thinkSeconds is seeded, bounded and zero when disabled', () => {
  const first = createRng(1)
  const second = createRng(1)
  for (let index = 0; index < 200; index += 1) {
    const value = thinkSeconds(first, { minSeconds: 5, maxSeconds: 30 })
    assert.equal(thinkSeconds(second, { minSeconds: 5, maxSeconds: 30 }), value)
    assert.ok(value >= 5 && value <= 30)
  }
  assert.equal(thinkSeconds(first, { enabled: false }), 0)
  assert.equal(thinkSeconds(first, { scale: 0 }), 0)
  const scaled = thinkSeconds(createRng(2), { minSeconds: 10, maxSeconds: 10, scale: 0.5 })
  assert.equal(scaled, 5)
})
