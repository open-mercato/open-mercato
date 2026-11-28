import type { UsagePair, UsagePairGroup, UsageRules } from './types'

export function mergePairGroups(groups: UsagePairGroup[]): UsagePairGroup {
  const merged: UsagePairGroup = {}
  for (const group of groups) {
    for (const [entryId, pairs] of Object.entries(group)) {
      if (merged[entryId]) throw new Error(`[internal] usage visuals declared twice for entry "${entryId}"`)
      merged[entryId] = pairs
    }
  }
  return merged
}

export function pairsOf(registry: UsagePairGroup, entryId: string): UsagePair[] {
  return registry[entryId] ?? []
}

export function entryIdsOf(registry: UsagePairGroup): string[] {
  return Object.keys(registry).filter((entryId) => registry[entryId].length > 0)
}

export function coveredRuleTexts(pairs: UsagePair[]): Set<string> {
  return new Set(pairs.flatMap((pair) => pair.covers ?? []))
}

export function withoutCoveredRules(rules: string[], covered: ReadonlySet<string>): string[] {
  return rules.filter((rule) => !covered.has(rule))
}

export function unresolvedCovers(pairs: UsagePair[], usage: UsageRules): string[] {
  const known = new Set([...usage.do, ...usage.dont])
  return [...coveredRuleTexts(pairs)].filter((rule) => !known.has(rule))
}

export function duplicatePairIds(pairs: UsagePair[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const pair of pairs) {
    if (seen.has(pair.id)) duplicates.add(pair.id)
    seen.add(pair.id)
  }
  return [...duplicates]
}
