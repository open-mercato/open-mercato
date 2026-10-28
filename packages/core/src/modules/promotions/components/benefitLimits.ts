// Pure state/transition helpers for the benefit card's "Applies to" / "Limits" /
// "Which pieces" controls (Step 1.8, SPEC-055 §UI/UX "Rule Group Tree Builder" +
// §Data Models "Quantity caps (shared config block)"). No React, no i18n — kept pure
// so the "which states are reachable" logic is unit-testable on its own, and so
// `BenefitCard.tsx` never has to re-derive the write-path rejection rules from prose.
//
// `data/validators.ts`'s `checkQuantityCapRules` (Step 1.2) is the single source of
// truth for what the server rejects; every function here exists to make the rejected
// states IMPOSSIBLE TO REACH from this UI, not merely to flag them after the fact:
//
//   1. a quantity cap (`maxQuantity`/`maxLines`) with no `selector`          → `applyQuantityCapChange` auto-assigns a selector the moment a cap gets a value.
//   2. `selector: 'all'` combined with a cap                                → `'all'` is never offered by `CAPPED_SELECTOR_OPTIONS` and never written by any helper here.
//   3. `selector: 'nth'` combined with a cap                                → `'nth'` is excluded from `CAPPED_SELECTOR_OPTIONS`, and `resolveBenefitLimitsState().nthToggleDisabled` is true whenever a cap is set.
//   4. `nth` without `nthPosition` (or vice versa)                         → `applyNthToggleChange` always sets/clears both together; `nthPosition` is only ever rendered while `selector === 'nth'`.
//   5. `quantityStep` under `appliesTo: 'line'`                            → `resolveBenefitLimitsState().showQuantityStep` is false for `'line'`, and `applyAppliesToChange` clears it on that transition.

import { promotionBenefitAppliesToValues, quantityCapSelectorValues } from '../data/validators'
import type { AppliesToId } from './ruleTreeTypes'

// `quantityCapSelectorValues` (exported from `data/validators.ts`) is `['all', 'cart_order',
// 'cheapest', 'most_expensive', 'nth']` — the model's full set. This UI never writes `'all'`
// (an uncapped benefit with no selector is read as `'all'` server-side already, §Data Models)
// and only ever offers `'nth'` through the dedicated toggle below, never inside the
// capped-mode dropdown — see rejection rules 2 and 3 above.
export type CappedSelectorId = Exclude<(typeof quantityCapSelectorValues)[number], 'all' | 'nth'>
export const CAPPED_SELECTOR_OPTIONS: CappedSelectorId[] = quantityCapSelectorValues.filter(
  (value): value is CappedSelectorId => value !== 'all' && value !== 'nth',
)

export type BenefitLimitsConfig = {
  maxQuantity?: number | null
  maxLines?: number | null
  quantityStep?: number | null
  selector?: string | null
  nthPosition?: number | null
}

export type BenefitLimitsMode = 'none' | 'capped' | 'nth'

export type BenefitLimitsState = {
  /** `false` under `appliesTo: 'order'` — nothing to count, the whole Limits row hides. */
  showLimitsRow: boolean
  /** `false` under `appliesTo: 'order'` or `'line'` — blocks are units-only. */
  showQuantityStep: boolean
  hasCap: boolean
  mode: BenefitLimitsMode
  /** Options the capped-mode "Which pieces" dropdown may offer — never `'all'`/`'nth'`. */
  selectorOptions: CappedSelectorId[]
  /** The "Limit to the Nth piece/line" toggle is disabled whenever a quantity cap is set. */
  nthToggleDisabled: boolean
  /** `maxQuantity`/`maxLines` inputs are disabled while the Nth-position mode is engaged. */
  capInputsDisabled: boolean
}

export function resolveBenefitLimitsState(appliesTo: AppliesToId, config: BenefitLimitsConfig): BenefitLimitsState {
  const showLimitsRow = appliesTo !== 'order'
  const showQuantityStep = showLimitsRow && appliesTo !== 'line'
  if (!showLimitsRow) {
    return {
      showLimitsRow,
      showQuantityStep,
      hasCap: false,
      mode: 'none',
      selectorOptions: CAPPED_SELECTOR_OPTIONS,
      nthToggleDisabled: true,
      capInputsDisabled: false,
    }
  }
  const hasCap = config.maxQuantity != null || config.maxLines != null
  const mode: BenefitLimitsMode = hasCap ? 'capped' : config.selector === 'nth' ? 'nth' : 'none'
  return {
    showLimitsRow,
    showQuantityStep,
    hasCap,
    mode,
    selectorOptions: CAPPED_SELECTOR_OPTIONS,
    nthToggleDisabled: hasCap,
    capInputsDisabled: mode === 'nth',
  }
}

const DEFAULT_CAPPED_SELECTOR: CappedSelectorId = 'cart_order'

// Applies a `maxQuantity`/`maxLines` edit, keeping `selector`/`nthPosition` legal by
// construction (rejection rules 1, 3, 4 above).
export function applyQuantityCapChange(
  config: Record<string, unknown>,
  field: 'maxQuantity' | 'maxLines',
  value: number | null,
): Record<string, unknown> {
  const next = { ...config, [field]: value }
  const other = field === 'maxQuantity' ? config.maxLines : config.maxQuantity
  const willHaveCap = value != null || (typeof other === 'number' && other != null)
  if (willHaveCap) {
    const currentSelector = next.selector as string | null | undefined
    next.selector = CAPPED_SELECTOR_OPTIONS.includes(currentSelector as CappedSelectorId)
      ? currentSelector
      : DEFAULT_CAPPED_SELECTOR
    next.nthPosition = null
  } else {
    next.selector = null
    next.nthPosition = null
  }
  return next
}

// Applies a capped-mode "Which pieces" dropdown edit — only ever one of
// `CAPPED_SELECTOR_OPTIONS`, so rejection rules 2/3 never engage.
export function applyCappedSelectorChange(config: Record<string, unknown>, selector: CappedSelectorId): Record<string, unknown> {
  return { ...config, selector }
}

// Toggles the "limit to the Nth piece/line" mode. Always sets/clears `selector` and
// `nthPosition` together (rejection rule 4).
export function applyNthToggleChange(config: Record<string, unknown>, enabled: boolean): Record<string, unknown> {
  if (!enabled) return { ...config, selector: null, nthPosition: null }
  const currentPosition = config.nthPosition
  return {
    ...config,
    selector: 'nth',
    nthPosition: typeof currentPosition === 'number' && currentPosition > 0 ? currentPosition : 1,
  }
}

export function applyNthPositionChange(config: Record<string, unknown>, value: number | null): Record<string, unknown> {
  return { ...config, nthPosition: value }
}

// Applies an "Applies to" change, clearing fields that would otherwise become
// unreachable-but-still-stored dead config for the new value (rejection rule 5, plus
// the `order` cap rejection documented at the top of this file).
export function applyAppliesToChange(appliesTo: AppliesToId, config: Record<string, unknown>): Record<string, unknown> {
  if (appliesTo === 'order') {
    return { ...config, maxQuantity: null, maxLines: null, quantityStep: null, selector: null, nthPosition: null }
  }
  if (appliesTo === 'line') {
    return { ...config, quantityStep: null }
  }
  return { ...config }
}

export function applyQuantityStepChange(config: Record<string, unknown>, value: number | null): Record<string, unknown> {
  return { ...config, quantityStep: value }
}

// Re-exported so call sites needn't import `data/validators.ts` directly for the one
// value they need (parity check / defensive narrowing of server data).
export const appliesToValues = promotionBenefitAppliesToValues
