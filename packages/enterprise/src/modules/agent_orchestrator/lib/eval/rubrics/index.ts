import { z } from 'zod'
import { judgeRubricSchema, normalizeJudgeRubric, type JudgeRubric } from '../judgeRubric'
import { BUILTIN_RUBRICS, BUILTIN_RUBRICS_BY_KEY } from './builtins'

export { BUILTIN_RUBRICS, BUILTIN_RUBRICS_BY_KEY, type BuiltinRubric } from './builtins'

export const UNKNOWN_RUBRIC = 'unknown_rubric' as const
export const RUBRIC_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/

export const rubricKeySchema = z.string().regex(RUBRIC_KEY_PATTERN, 'rubric keys use letters, digits, "_", ".", ":" or "-" (max 100)')

/**
 * Per-assertion tuning a `{ rubricRef }` config may layer over the referenced
 * rubric. The rubric's wording, scoring and evaluation steps always come from
 * the library; these keys only adjust how it is applied.
 */
export const rubricTuningShape = {
  threshold: z.number().min(0).max(1).optional(),
  samples: z.number().int().min(1).max(9).optional(),
  requireReasoning: z.boolean().optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  seed: z.number().int().optional(),
  aggregation: z.enum(['majority', 'mean', 'min']).optional(),
  direction: z.enum(['gte', 'lte']).optional(),
}

const RUBRIC_TUNING_KEYS = Object.keys(rubricTuningShape) as Array<keyof typeof rubricTuningShape>

export type JudgeRubricInput = z.input<typeof judgeRubricSchema>
export type RubricSource = 'builtin' | 'agent'
export type ResolvedRubric = { key: string; source: RubricSource; rubric: JudgeRubric }
export type RubricDescriptor = { key: string; title: string; titleKey?: string; source: RubricSource }

export type JudgeRubricResolution =
  | { ok: true; rubric: JudgeRubric; rubricRef: string | null }
  | { ok: false; reason: typeof UNKNOWN_RUBRIC | 'invalid_config'; rubricRef: string | null }

const agentRubrics = new Map<string, ReadonlyMap<string, JudgeRubric>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validates `defineAgent({ evalRubrics })` at registration. A malformed rubric
 * throws immediately rather than surfacing as a skipped judge result later.
 */
export function parseAgentEvalRubrics(
  agentId: string,
  input: Record<string, JudgeRubricInput> | undefined,
): Record<string, JudgeRubric> | undefined {
  if (input === undefined) return undefined
  const parsed: Record<string, JudgeRubric> = {}
  for (const [key, raw] of Object.entries(input)) {
    if (!RUBRIC_KEY_PATTERN.test(key)) {
      throw new Error(`[internal] agent "${agentId}" declares an invalid eval rubric key "${key}"`)
    }
    const result = judgeRubricSchema.safeParse(raw)
    if (!result.success) {
      const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      throw new Error(`[internal] agent "${agentId}" declares an invalid eval rubric "${key}": ${issues.join('; ')}`)
    }
    parsed[key] = result.data
  }
  return Object.keys(parsed).length ? parsed : undefined
}

export function registerAgentRubrics(agentId: string, rubrics: Record<string, JudgeRubric> | undefined): void {
  if (!rubrics) {
    agentRubrics.delete(agentId)
    return
  }
  agentRubrics.set(agentId, new Map(Object.entries(rubrics)))
}

/** Resolution order: the agent's own rubric, then the built-in library. */
export function resolveRubricRef(agentId: string | null | undefined, ref: string): ResolvedRubric | null {
  const own = agentId ? agentRubrics.get(agentId)?.get(ref) : undefined
  if (own) return { key: ref, source: 'agent', rubric: own }
  const builtin = BUILTIN_RUBRICS_BY_KEY.get(ref)
  return builtin ? { key: ref, source: 'builtin', rubric: builtin.rubric } : null
}

/**
 * Write-time check. A wildcard (`*`) assertion is resolved per agent when it is
 * frozen, so it accepts a built-in or any key some registered agent declares.
 */
export function isKnownRubricRef(appliesTo: string, ref: string): boolean {
  if (appliesTo !== '*') return resolveRubricRef(appliesTo, ref) !== null
  if (BUILTIN_RUBRICS_BY_KEY.has(ref)) return true
  for (const rubrics of agentRubrics.values()) if (rubrics.has(ref)) return true
  return false
}

export function listRubrics(agentId?: string | null): RubricDescriptor[] {
  const own = agentId ? agentRubrics.get(agentId) : undefined
  const agentEntries: RubricDescriptor[] = own
    ? [...own.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((key) => ({ key, title: key, source: 'agent' as const }))
    : []
  const shadowed = new Set(agentEntries.map((entry) => entry.key))
  const builtinEntries: RubricDescriptor[] = BUILTIN_RUBRICS.filter((entry) => !shadowed.has(entry.key)).map((entry) => ({
    key: entry.key,
    title: entry.title,
    titleKey: entry.titleKey,
    source: 'builtin' as const,
  }))
  return [...agentEntries, ...builtinEntries]
}

export function readRubricRef(config: unknown): string | null {
  if (!isRecord(config)) return null
  return typeof config.rubricRef === 'string' && config.rubricRef.length > 0 ? config.rubricRef : null
}

export function collectRubricRefs(configs: Iterable<unknown>): string[] {
  const refs = new Set<string>()
  for (const config of configs) {
    const ref = readRubricRef(config)
    if (ref) refs.add(ref)
  }
  return [...refs]
}

/** Layers the per-assertion tuning keys of `config` over a library rubric. */
export function applyRubricTuning(rubric: JudgeRubric, config: unknown): JudgeRubric | null {
  if (!isRecord(config)) return rubric
  const tuning: Record<string, unknown> = {}
  for (const key of RUBRIC_TUNING_KEYS) if (config[key] !== undefined) tuning[key] = config[key]
  if (!Object.keys(tuning).length) return rubric
  const parsed = judgeRubricSchema.safeParse({ ...rubric, ...tuning })
  return parsed.success ? parsed.data : null
}

/**
 * Single entry point for turning a stored judge config into the rubric the judge
 * runs: `{ rubricRef }` resolves through the library (agent first, then
 * built-in) with its tuning applied; any other shape goes through
 * `normalizeJudgeRubric`. An unknown ref is never lifted into a legacy rubric.
 */
export function resolveJudgeRubric(
  config: unknown,
  options: { agentId: string | null | undefined; fallbackText: string },
): JudgeRubricResolution {
  const rubricRef = readRubricRef(config)
  if (rubricRef) {
    const resolved = resolveRubricRef(options.agentId, rubricRef)
    if (!resolved) return { ok: false, reason: UNKNOWN_RUBRIC, rubricRef }
    const tuned = applyRubricTuning(resolved.rubric, config)
    return tuned ? { ok: true, rubric: tuned, rubricRef } : { ok: false, reason: 'invalid_config', rubricRef }
  }
  const rubric = normalizeJudgeRubric(config, options.fallbackText)
  return rubric ? { ok: true, rubric, rubricRef: null } : { ok: false, reason: 'invalid_config', rubricRef: null }
}

let agentRubricsLoad: Promise<void> | null = null

/**
 * Agent rubrics register when `defineAgent` runs, which happens only once the
 * agent modules are imported. Callers that validate or freeze a `rubricRef`
 * outside a run load them first.
 */
export async function ensureAgentRubricsLoaded(): Promise<void> {
  if (!agentRubricsLoad) {
    agentRubricsLoad = import('../../sdk/defineAgent')
      .then(({ ensureAgentsLoaded }) => ensureAgentsLoaded())
      .catch(() => {
        agentRubricsLoad = null
      })
  }
  await agentRubricsLoad
}

/**
 * Loads agent rubrics when any ref is present — a built-in key included, because
 * an agent may shadow it and resolution must not depend on load order.
 */
export async function ensureRubricLibrary(refs: Iterable<string>): Promise<void> {
  if ([...refs].length > 0) await ensureAgentRubricsLoaded()
}
