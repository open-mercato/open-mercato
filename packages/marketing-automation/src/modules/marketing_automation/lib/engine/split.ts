import type { CampaignStep } from './types.js'

export const SPLIT_STEP_TYPE = 'split'

export type SplitVariant = {
  key: string
  weight: number
  steps: CampaignStep[]
}

/**
 * Deterministic 32-bit FNV-1a.
 *
 * Deliberately a few lines here rather than `node:crypto`: this module is part of the pure engine,
 * and the choice only needs to be stable and evenly spread, not cryptographic. Keeping it dependency
 * free also means the same function can run in a test, a worker and (later) a preview in the browser
 * and agree on the answer — which is the whole point.
 */
function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function isStepShape(value: unknown): value is CampaignStep {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { type?: unknown }).type === 'string'
}

/**
 * Reads the lanes of a split step, dropping anything malformed.
 *
 * A lane with a non-positive weight is dropped rather than treated as zero-probability, because a
 * lane that can never be chosen is almost always a mistake in the definition and silently keeping it
 * would make the canvas show a branch that never runs.
 */
export function readVariants(step: CampaignStep): SplitVariant[] {
  const raw = step.params?.variants
  if (!Array.isArray(raw)) return []
  const variants: SplitVariant[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as { key?: unknown; weight?: unknown; steps?: unknown }
    if (typeof entry.key !== 'string' || !entry.key) continue
    const weight = typeof entry.weight === 'number' ? entry.weight : Number(entry.weight)
    if (!Number.isFinite(weight) || weight <= 0) continue
    const steps = Array.isArray(entry.steps) ? entry.steps.filter(isStepShape) : []
    variants.push({ key: entry.key, weight, steps })
  }
  return variants
}

/**
 * Picks a lane for one subject, stably.
 *
 * Stability is the whole requirement: a run that pauses on a wait inside a lane and resumes an hour
 * later MUST land in the same lane, or the customer would receive a mixture of both variants and the
 * test would measure nothing. Deriving the choice from the step id and the subject identity makes
 * that true by construction, with no stored state to migrate, lose, or disagree with itself.
 *
 * Weighted by cumulative ranges, so `[{a,3},{b,1}]` sends three quarters of subjects to `a`.
 */
export function selectVariant(step: CampaignStep, subjectKey: string): SplitVariant | null {
  const variants = readVariants(step)
  if (variants.length === 0) return null

  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  // The hash is folded into [0, 1) and scaled, rather than taken modulo the weight sum, so weights
  // do not have to be integers.
  const point = (hash32(`${step.id}:${subjectKey}`) / 0x100000000) * total

  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (point < cumulative) return variant
  }
  return variants[variants.length - 1]
}

/**
 * Resolves the authored tree into the linear chain this subject will actually walk.
 *
 * The executor and the planner stay index-based, which is what keeps `current_step_index` meaningful
 * and the schema unchanged: each run's index refers to its own flattening, and because the lane
 * choice is deterministic the same flattening is reproduced on every resume.
 *
 * A split contributes its chosen lane IN PLACE and the outer chain continues afterwards, so a split
 * is a detour rather than a terminus — which is what lets a campaign test one message and then carry
 * on with shared follow-up steps.
 */
export function flattenSteps(steps: CampaignStep[], subjectKey: string, depth = 0): CampaignStep[] {
  // A definition can only nest as deep as an author made it, but a hand-edited or imported one could
  // be cyclic in spirit; the cap turns a pathological definition into a truncated campaign rather
  // than a stack overflow in a worker.
  if (depth > 5) return []

  const flattened: CampaignStep[] = []
  for (const step of steps) {
    if (step.type !== SPLIT_STEP_TYPE) {
      flattened.push(step)
      continue
    }
    const variant = selectVariant(step, subjectKey)
    if (!variant) continue
    flattened.push(...flattenSteps(variant.steps, subjectKey, depth + 1))
  }
  return flattened
}

/** Which lane each split in a definition assigned this subject, for reporting. */
export function describeVariantChoices(steps: CampaignStep[], subjectKey: string): Record<string, string> {
  const choices: Record<string, string> = {}
  const walk = (list: CampaignStep[], depth: number) => {
    if (depth > 5) return
    for (const step of list) {
      if (step.type !== SPLIT_STEP_TYPE) continue
      const variant = selectVariant(step, subjectKey)
      if (!variant) continue
      choices[step.id] = variant.key
      walk(variant.steps, depth + 1)
    }
  }
  walk(steps, 0)
  return choices
}

/** Writes lanes back onto a split step, leaving its other params untouched. */
export function writeVariants(step: CampaignStep, variants: SplitVariant[]): CampaignStep {
  return {
    ...step,
    params: {
      ...step.params,
      variants: variants.map((variant) => ({ key: variant.key, weight: variant.weight, steps: variant.steps })),
    },
  }
}

/**
 * A split with the two empty lanes its schema requires.
 *
 * A split created with no lanes would be rejected by the save validation the moment the author
 * pressed Save, so the palette hands them something already valid to fill in.
 */
export function makeSplitStep(id: string, keys: string[] = ['a', 'b']): CampaignStep {
  return { id, type: SPLIT_STEP_TYPE, params: { variants: keys.map((key) => ({ key, weight: 1, steps: [] })) } }
}
