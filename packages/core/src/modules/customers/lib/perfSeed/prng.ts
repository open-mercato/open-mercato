import { createHash } from 'node:crypto'

export type Rng = {
  next: () => number
  int: (min: number, max: number) => number
  chance: (probability: number) => boolean
  pick: <T>(values: readonly T[]) => T
  weighted: (weights: readonly number[]) => number
  between: (min: number, max: number) => number
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let position = 0; position < input.length; position += 1) {
    hash ^= input.charCodeAt(position)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(key: string): Rng {
  const next = mulberry32(fnv1a32(key))
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const weighted = (weights: readonly number[]) => {
    let total = 0
    for (const weight of weights) total += weight
    let target = next() * total
    for (let position = 0; position < weights.length; position += 1) {
      target -= weights[position]
      if (target < 0) return position
    }
    return weights.length - 1
  }
  return {
    next,
    int,
    chance: (probability: number) => next() < probability,
    pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)],
    weighted,
    between: (min: number, max: number) => min + next() * (max - min),
  }
}

export function deterministicUuid(namespace: string, ...parts: Array<string | number>): string {
  const digest = createHash('sha1').update(namespace).update('|').update(parts.join('|')).digest('hex')
  const variant = ((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(18, 20)}`,
    digest.slice(20, 32),
  ].join('-')
}

export function zipfWeights(size: number, exponent: number): number[] {
  return Array.from({ length: size }, (_, rank) => 1 / Math.pow(rank + 1, exponent))
}
