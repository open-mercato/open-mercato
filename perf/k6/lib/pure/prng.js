const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function hashSeed(text) {
  let hash = FNV_OFFSET
  const source = String(text)
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

export function createRng(seed) {
  let state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function randomInt(rng, min, max) {
  const low = Math.ceil(Math.min(min, max))
  const high = Math.floor(Math.max(min, max))
  return low + Math.floor(rng() * (high - low + 1))
}

export function randomBetween(rng, min, max) {
  return min + rng() * (max - min)
}

export function isListLike(list) {
  return list !== null && list !== undefined && typeof list !== 'string' && typeof list.length === 'number'
}

export function pickOne(rng, list) {
  if (!isListLike(list) || list.length === 0) return undefined
  return list[Math.floor(rng() * list.length)]
}

export function pickDistinct(rng, list, count) {
  if (!isListLike(list) || list.length === 0) return []
  const pool = Array.from(list)
  const wanted = Math.min(count, pool.length)
  for (let index = 0; index < wanted; index += 1) {
    const swapWith = index + Math.floor(rng() * (pool.length - index))
    const current = pool[index]
    pool[index] = pool[swapWith]
    pool[swapWith] = current
  }
  return pool.slice(0, wanted)
}
