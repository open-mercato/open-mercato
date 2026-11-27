import { BLOCK_PAIRS } from './blocks'
import { COMPONENT_PAIRS } from './components'
import { FOUNDATION_PAIRS } from './foundations'
import { coveredRuleTexts, entryIdsOf, mergePairGroups, pairsOf, withoutCoveredRules } from './registry-helpers'
import type { UsagePair, UsageRules } from './types'

export const USAGE_PAIRS = mergePairGroups([FOUNDATION_PAIRS, COMPONENT_PAIRS, BLOCK_PAIRS])

export function usagePairsFor(entryId: string): UsagePair[] {
  return pairsOf(USAGE_PAIRS, entryId)
}

export function usageVisualEntryIds(): string[] {
  return entryIdsOf(USAGE_PAIRS)
}

export function hasUsageVisuals(entryId: string): boolean {
  return usagePairsFor(entryId).length > 0
}

export function visibleUsageRules(entryId: string, usage: UsageRules): UsageRules {
  const covered = coveredRuleTexts(usagePairsFor(entryId))
  return { do: withoutCoveredRules(usage.do, covered), dont: withoutCoveredRules(usage.dont, covered) }
}
