import { readVariants, SPLIT_STEP_TYPE, writeVariants } from '../engine/split.js'
import type { SplitVariant } from '../engine/split.js'
import type { CampaignStep } from '../engine/types.js'

/**
 * Structural edits over the authored step tree.
 *
 * Once splits exist, a campaign is no longer a flat array: a step lives either at the top level or
 * inside one lane of one split, arbitrarily deep. Every editor action — change params, reorder,
 * delete, add — therefore has to find the chain that owns the step rather than index into
 * `definition.steps`.
 *
 * All of that is here, pure and recursive, so the editor page stays a rendering of state and the
 * rules are testable without React. Each function returns a new tree and never mutates its input.
 */

/** Where a step sits: which chain owns it, and where in that chain. */
export type StepLocation = {
  step: CampaignStep
  index: number
  siblingCount: number
  /** The lane that owns it, or `null` for the top-level chain. */
  lane: { splitId: string; laneKey: string } | null
}

const MAX_DEPTH = 5

function isSplit(step: CampaignStep): boolean {
  return step.type === SPLIT_STEP_TYPE
}

export function locateStep(
  steps: CampaignStep[],
  stepId: string,
  lane: StepLocation['lane'] = null,
  depth = 0,
): StepLocation | null {
  if (depth > MAX_DEPTH) return null
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    if (step.id === stepId) return { step, index, siblingCount: steps.length, lane }
    if (!isSplit(step)) continue
    for (const variant of readVariants(step)) {
      const found = locateStep(variant.steps, stepId, { splitId: step.id, laneKey: variant.key }, depth + 1)
      if (found) return found
    }
  }
  return null
}

/**
 * Rewrites every chain in the tree with `transform`, bottom-up.
 *
 * One traversal behind params changes, reordering and deletion: they differ only in what they do to
 * the chain that contains the step, so each is a two-line caller instead of its own recursion.
 */
function mapChains(
  steps: CampaignStep[],
  transform: (chain: CampaignStep[]) => CampaignStep[],
  depth = 0,
): CampaignStep[] {
  if (depth > MAX_DEPTH) return steps
  const descended = steps.map((step) => {
    if (!isSplit(step)) return step
    const variants = readVariants(step).map((variant) => ({
      ...variant,
      steps: mapChains(variant.steps, transform, depth + 1),
    }))
    return writeVariants(step, variants)
  })
  return transform(descended)
}

export function updateStepParams(
  steps: CampaignStep[],
  stepId: string,
  params: Record<string, unknown>,
): CampaignStep[] {
  return mapChains(steps, (chain) => chain.map((step) => (step.id === stepId ? { ...step, params } : step)))
}

export function removeStep(steps: CampaignStep[], stepId: string): CampaignStep[] {
  return mapChains(steps, (chain) => chain.filter((step) => step.id !== stepId))
}

/** Moves a step within its own chain. A step never moves between lanes by accident. */
export function moveStep(steps: CampaignStep[], stepId: string, delta: -1 | 1): CampaignStep[] {
  return mapChains(steps, (chain) => {
    const index = chain.findIndex((step) => step.id === stepId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= chain.length) return chain
    const next = [...chain]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    return next
  })
}

/** Appends a step to the end of the top-level chain, or of one lane. */
export function appendStep(
  steps: CampaignStep[],
  step: CampaignStep,
  lane: StepLocation['lane'] = null,
): CampaignStep[] {
  if (!lane) return [...steps, step]
  return mapChains(steps, (chain) => chain.map((candidate) => {
    if (candidate.id !== lane.splitId || !isSplit(candidate)) return candidate
    const variants = readVariants(candidate).map((variant) => (
      variant.key === lane.laneKey ? { ...variant, steps: [...variant.steps, step] } : variant
    ))
    return writeVariants(candidate, variants)
  }))
}

function mapVariants(
  steps: CampaignStep[],
  splitId: string,
  transform: (variants: SplitVariant[]) => SplitVariant[],
): CampaignStep[] {
  return mapChains(steps, (chain) => chain.map((step) => (
    step.id === splitId && isSplit(step) ? writeVariants(step, transform(readVariants(step))) : step
  )))
}

/** Adds a lane, naming it after the first free letter so two lanes never share a key. */
export function addVariant(steps: CampaignStep[], splitId: string): CampaignStep[] {
  return mapVariants(steps, splitId, (variants) => {
    const used = new Set(variants.map((variant) => variant.key))
    let key = ''
    for (let offset = 0; offset < 26 && !key; offset += 1) {
      const candidate = String.fromCharCode(97 + offset)
      if (!used.has(candidate)) key = candidate
    }
    if (!key) key = `v${variants.length + 1}`
    return [...variants, { key, weight: 1, steps: [] }]
  })
}

export function updateVariant(
  steps: CampaignStep[],
  splitId: string,
  laneKey: string,
  patch: { key?: string; weight?: number },
): CampaignStep[] {
  return mapVariants(steps, splitId, (variants) => {
    // The key and the weight are what make a lane exist at all: `readVariants` drops a lane with an
    // empty key or a non-positive weight, so accepting either from an input mid-edit would delete the
    // lane the author is editing, together with the steps inside it.
    if (patch.key !== undefined && !patch.key.trim()) return variants
    if (patch.key !== undefined && variants.some((variant) => variant.key === patch.key && variant.key !== laneKey)) {
      return variants
    }
    if (patch.weight !== undefined && (!Number.isFinite(patch.weight) || patch.weight <= 0)) return variants
    return variants.map((variant) => (variant.key === laneKey ? { ...variant, ...patch } : variant))
  })
}

/** Removes a lane and everything authored inside it. */
export function removeVariant(steps: CampaignStep[], splitId: string, laneKey: string): CampaignStep[] {
  return mapVariants(steps, splitId, (variants) => variants.filter((variant) => variant.key !== laneKey))
}

/** Every step id in the tree, which is what the canvas prunes stale node positions against. */
export function collectStepIds(steps: CampaignStep[], depth = 0): string[] {
  if (depth > MAX_DEPTH) return []
  const ids: string[] = []
  for (const step of steps) {
    ids.push(step.id)
    if (!isSplit(step)) continue
    for (const variant of readVariants(step)) ids.push(...collectStepIds(variant.steps, depth + 1))
  }
  return ids
}
