import { z } from 'zod'
import type { Json, ScorerVerdict } from '../types'

/** Every threshold-bearing scorer states its direction explicitly — never per-type folklore. */
export const directionSchema = z.enum(['gte', 'lte'])
export type ThresholdDirection = z.infer<typeof directionSchema>

/**
 * Comparison target origin. `expected` reads the eval case's expected value and is
 * unavailable online (an AgentRun has no case attached); `config` reads the
 * assertion's own `value` and works on both planes.
 */
export const sourceSchema = z.enum(['expected', 'config']).default('expected')

/** Applied centrally by the registry resolver, so no scorer implements it itself. */
export const negateSchema = z.boolean().optional()

export const baseConfigSchema = z.object({ negate: negateSchema })

export function toText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/**
 * Minimal path resolver: dot segments with optional bracket indices (`a.b[0].c`).
 * Deliberately not full JSONPath — the surface an assertion author needs is a
 * field address, and a full query language would be a second config grammar.
 */
/** Never traversed: a config path must not be able to reach the prototype chain. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function resolvePath(value: Json | null, path?: string | null): Json | null {
  if (!path) return value
  let current: Json | null = value
  const segments = path.split('.').flatMap((segment) => {
    const parts: string[] = []
    const name = segment.replace(/\[(\d+)\]/g, (_, index: string) => {
      parts.push(index)
      return ''
    })
    return name ? [name, ...parts] : parts
  })
  for (const segment of segments) {
    if (UNSAFE_SEGMENTS.has(segment)) return null
    if (current === null || typeof current !== 'object') return null
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return null
    current = (current as Record<string, Json>)[segment] ?? null
  }
  return current
}

export function verdict(passed: boolean, score?: number, evidence?: Json): ScorerVerdict {
  return { passed, score: score ?? (passed ? 1 : 0), evidence }
}

export function compareThreshold(
  actual: number | null,
  threshold: number,
  direction: ThresholdDirection,
): boolean {
  if (actual === null) return false
  return direction === 'gte' ? actual >= threshold : actual <= threshold
}

/** Structural equality over JSON values, key-order independent. */
export function jsonEquals(left: Json | null, right: Json | null): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left !== typeof right) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index] ?? null))
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left as object)
    const rightKeys = Object.keys(right as object)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) =>
      jsonEquals((left as Record<string, Json>)[key] ?? null, (right as Record<string, Json>)[key] ?? null),
    )
  }
  return false
}

/**
 * Subset match: every key present in `expected` must match in `actual`; extra keys
 * in `actual` are ignored. This is the default for `json_match` because an expected
 * payload rarely enumerates every field, and exact equality would make the
 * correction flywheel useless in practice.
 */
export function jsonSubsetMatch(
  actual: Json | null,
  expected: Json | null,
  ignore: ReadonlyArray<string> = [],
): { matched: boolean; mismatches: string[]; mismatchedLeaves: number; comparedLeaves: number } {
  const mismatches: string[] = []
  const ignored = new Set(ignore)
  let mismatchedLeaves = 0
  // Counted DURING the walk, not from the target tree: `walk` descends only into
  // plain objects, so an array on the expected side is ONE comparison while
  // `countLeaves` would expand it to N — and ignored paths are never compared.
  // Using the target's leaf count as the denominator scored a total mismatch of a
  // 10-element array as 0.9.
  let comparedLeaves = 0

  const walk = (left: Json | null, right: Json | null, path: string): void => {
    if (ignored.has(path)) return
    if (right !== null && typeof right === 'object' && !Array.isArray(right)) {
      if (left === null || typeof left !== 'object' || Array.isArray(left)) {
        mismatches.push(path || '.')
        // A diverging SUBTREE counts as all of its leaves, not as one mismatch:
        // otherwise `{a:{x,y,z}}` vs `{a:5}` scores 0.67 while matching nothing.
        const leaves = countLeaves(right)
        mismatchedLeaves += leaves
        comparedLeaves += leaves
        return
      }
      for (const key of Object.keys(right as object)) {
        const childPath = path ? `${path}.${key}` : key
        walk(
          (left as Record<string, Json>)[key] ?? null,
          (right as Record<string, Json>)[key] ?? null,
          childPath,
        )
      }
      return
    }
    comparedLeaves += 1
    if (!jsonEquals(left, right)) {
      mismatches.push(path || '.')
      mismatchedLeaves += 1
    }
  }

  walk(actual, expected, '')
  return { matched: mismatches.length === 0, mismatches, mismatchedLeaves, comparedLeaves }
}

/** Scores a partial match as the fraction of compared leaves that agreed. */
export function subsetScore(mismatches: number, comparedLeaves: number): number {
  if (comparedLeaves <= 0) return mismatches === 0 ? 1 : 0
  return Math.max(0, (comparedLeaves - mismatches) / comparedLeaves)
}

export function countLeaves(value: Json | null): number {
  if (value === null || typeof value !== 'object') return 1
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countLeaves(item), 0) || 1
  const keys = Object.keys(value as object)
  if (!keys.length) return 1
  return keys.reduce<number>((sum, key) => sum + countLeaves((value as Record<string, Json>)[key] ?? null), 0)
}

export function matchesNameOrPattern(candidate: string, name?: string, pattern?: string): boolean {
  if (name) return candidate === name
  // No selector matches nothing rather than everything: a blank step in a
  // `tool_sequence` must not silently match any tool. Callers that mean "all"
  // skip this helper entirely.
  if (!pattern) return false
  // Glob-style: `*` matches any run of characters. Anchored so `search*` does not
  // accidentally match `research_tool`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(candidate)
}
