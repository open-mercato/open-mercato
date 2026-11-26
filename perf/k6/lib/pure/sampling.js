import { isListLike, pickOne } from './prng.js'
import { pickWeighted } from './weights.js'

export const DEFAULT_BUCKET_WEIGHTS = { lightMedium: 80, heavy: 15, extreme: 5 }

export function idOf(entry) {
  if (entry === null || entry === undefined) return undefined
  if (typeof entry === 'string') return entry
  if (typeof entry === 'object') return entry.id ?? entry.entityId ?? entry.userId ?? undefined
  return String(entry)
}

export function idsOf(list) {
  return (isListLike(list) ? Array.from(list) : []).map(idOf).filter((value) => typeof value === 'string' && value.length > 0)
}

export function bucketPools(buckets) {
  const source = buckets ?? {}
  return {
    lightMedium: idsOf(source.light).concat(idsOf(source.medium)),
    heavy: idsOf(source.heavy),
    extreme: idsOf(source.extreme),
  }
}

export function pickBucket(rng, bucketWeights = DEFAULT_BUCKET_WEIGHTS, pools = null) {
  const entries = Object.keys(bucketWeights)
    .map((name) => ({ name, weight: Number(bucketWeights[name]) }))
    .filter((entry) => entry.weight > 0 && (!pools || (pools[entry.name] && pools[entry.name].length > 0)))
  const picked = pickWeighted(rng, entries)
  return picked ? picked.name : undefined
}

export function sampleEntity(rng, pools, bucketWeights = DEFAULT_BUCKET_WEIGHTS) {
  const bucket = pickBucket(rng, bucketWeights, pools)
  if (!bucket) return undefined
  return { bucket, id: pickOne(rng, pools[bucket]) }
}

export function partitionSlice(list, partitionIndex, partitionCount) {
  const items = isListLike(list) ? list : []
  const count = Math.max(1, Math.floor(partitionCount))
  const index = ((Math.floor(partitionIndex) % count) + count) % count
  if (items.length === 0) return []
  if (items.length < count) return [items[index % items.length]]
  const result = []
  for (let cursor = index; cursor < items.length; cursor += count) result.push(items[cursor])
  return result
}

export function pickWriteTarget(rng, { partition, hotSet, hotShare = 0.1 }) {
  const hotPool = isListLike(hotSet) ? hotSet : []
  const ownPool = isListLike(partition) ? partition : []
  const useHot = hotPool.length > 0 && (rng() < hotShare || ownPool.length === 0)
  if (useHot) return { id: pickOne(rng, hotPool), hot: true }
  if (ownPool.length === 0) return undefined
  return { id: pickOne(rng, ownPool), hot: false }
}
