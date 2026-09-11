import { z } from 'zod'
import { agentTypeSchema } from '../../../data/validators'
import { normalizeProposalEnvelope } from '../../../data/proposalEnvelope'
import type { Json, ScorerDefinition } from '../types'
import { SKIP_REASON, skipped } from '../types'
import { baseConfigSchema, directionSchema, toText, verdict } from './shared'

const I18N = 'agent_orchestrator.evalAssertions.scorer'

// Non-global patterns (presence detection only) — keeps scorers stateless/pure.
const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'phone', re: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
]

const outputPresentConfig = baseConfigSchema
export type OutputPresentConfig = z.infer<typeof outputPresentConfig>

/**
 * Behaviour preserved verbatim from the pre-registry scorer so the Phase 1
 * migration cannot move an online `gate` verdict.
 */
export const outputPresent: ScorerDefinition<OutputPresentConfig> = {
  scorerKey: 'output_present',
  labelKey: `${I18N}.output_present`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: outputPresentConfig,
  fields: [],
  needsExpected: () => false,
  score: (run) => {
    const output = run.output
    const empty =
      output === null ||
      output === undefined ||
      (typeof output === 'object' && Object.keys(output as object).length === 0)
    return verdict(!empty, empty ? 0 : 1)
  },
}

/**
 * Element-wise coercion, not `z.array(z.string())`.
 *
 * The pre-registry code was `Array.isArray(c.requiredKeys) ? c.requiredKeys : []`
 * — no element-type check — so a stored `['status', 1]` produced `missing: [1]`
 * and FAILED. A whole-array `z.string()` schema fails on the one bad element and
 * `.catch([])` then substitutes an EMPTY list, which passes vacuously: a stored
 * gate silently flips fail → pass. Coercing per element reproduces the original
 * key lookup instead of discarding the list.
 */
const requiredKeysConfig = baseConfigSchema.extend({
  requiredKeys: z
    .array(z.unknown())
    .catch([])
    .transform((entries) => entries.map((entry) => String(entry))),
})
export type RequiredKeysConfig = z.infer<typeof requiredKeysConfig>

/**
 * Retained as its own scorer rather than folded into `json_match`: user-authored
 * rows may carry `gate` severity, and rewriting their config blind risks moving an
 * online verdict for zero benefit. New assertions should prefer `json_match`.
 *
 * @deprecated for new assertions — use `json_match` with `source: 'config'`.
 */
export const requiredKeys: ScorerDefinition<RequiredKeysConfig> = {
  scorerKey: 'required_keys',
  labelKey: `${I18N}.required_keys`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: requiredKeysConfig,
  fields: [
    {
      name: 'requiredKeys',
      kind: 'string-list',
      labelKey: `${I18N}.required_keys.field.requiredKeys`,
      hintKey: `${I18N}.required_keys.field.requiredKeys.hint`,
      required: true,
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const required = config.requiredKeys ?? []
    const output = run.output
    if (!output || typeof output !== 'object') {
      return verdict(false, 0, { reason: 'output is not an object' })
    }
    const present = output as Record<string, Json>
    const missing = required.filter((key) => !(key in present))
    return {
      passed: missing.length === 0,
      score: required.length ? (required.length - missing.length) / required.length : 1,
      evidence: missing.length ? { missing } : undefined,
    }
  },
}

/**
 * Evaluation schema is deliberately as loose as the code it replaces
 * (`typeof config.threshold === 'number' ? config.threshold : 0.5`). An
 * out-of-range threshold such as `85` — the percent-vs-fraction mistake — used to
 * make a gate assertion fail EVERY run; rejecting it here would skip the
 * assertion, drop it from the gate, and flip `evalPassed` from false to true. The
 * gate would fail open.
 */
const confidenceThresholdConfig = baseConfigSchema.extend({
  threshold: z.number().catch(0.5),
  direction: directionSchema.catch('gte'),
})
export type ConfidenceThresholdConfig = z.infer<typeof confidenceThresholdConfig>

/** Range is enforced only on write, where rejecting cannot move a stored verdict. */
const confidenceThresholdWriteConfig = baseConfigSchema.extend({
  threshold: z.number().min(0).max(1).default(0.5),
  direction: directionSchema.default('gte'),
})

/**
 * Supersedes `min_confidence` (kept as a deprecated alias in the registry index).
 *
 * NOTE — deliberate exception to the skip doctrine: a run with no confidence
 * returns `passed: false`, NOT a skip. This reproduces the shipped
 * `min_confidence` behaviour exactly; skipping instead would silently convert an
 * existing online failure into a non-result and move `evalPassed`.
 */
export const confidenceThreshold: ScorerDefinition<ConfidenceThresholdConfig> = {
  scorerKey: 'confidence_threshold',
  labelKey: `${I18N}.confidence_threshold`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: confidenceThresholdConfig,
  writeConfigSchema: confidenceThresholdWriteConfig,
  fields: [
    {
      name: 'threshold',
      kind: 'slider',
      labelKey: `${I18N}.confidence_threshold.field.threshold`,
      hintKey: `${I18N}.confidence_threshold.field.threshold.hint`,
      min: 0,
      max: 1,
      step: 0.05,
      required: true,
      default: 0.5,
    },
    {
      name: 'direction',
      kind: 'select',
      labelKey: `${I18N}.field.direction`,
      options: [
        { value: 'gte', labelKey: `${I18N}.direction.gte` },
        { value: 'lte', labelKey: `${I18N}.direction.lte` },
      ],
      default: 'gte',
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const threshold = config.threshold
    const confidence = typeof run.confidence === 'number' ? run.confidence : null
    if (confidence === null) {
      return verdict(false, 0, { reason: 'run has no confidence' })
    }
    const passed = config.direction === 'gte' ? confidence >= threshold : confidence <= threshold
    return { passed, score: confidence, evidence: { confidence, threshold, direction: config.direction } }
  },
}

const dispositionEqualsConfig = baseConfigSchema.extend({
  expected: z.enum(['pending', 'auto_approved', 'approved', 'edited', 'rejected', 'user_task']),
})
export type DispositionEqualsConfig = z.infer<typeof dispositionEqualsConfig>

/**
 * The orchestration-specific assertion no general-purpose eval framework can
 * express: did the agent correctly escalate to a human instead of auto-approving?
 */
export const dispositionEquals: ScorerDefinition<DispositionEqualsConfig> = {
  scorerKey: 'disposition_equals',
  labelKey: `${I18N}.disposition_equals`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: dispositionEqualsConfig,
  fields: [
    {
      name: 'expected',
      kind: 'select',
      labelKey: `${I18N}.disposition_equals.field.expected`,
      hintKey: `${I18N}.disposition_equals.field.expected.hint`,
      required: true,
      options: [
        { value: 'pending', labelKey: `${I18N}.disposition.pending` },
        { value: 'auto_approved', labelKey: `${I18N}.disposition.auto_approved` },
        { value: 'approved', labelKey: `${I18N}.disposition.approved` },
        { value: 'edited', labelKey: `${I18N}.disposition.edited` },
        { value: 'rejected', labelKey: `${I18N}.disposition.rejected` },
        { value: 'user_task', labelKey: `${I18N}.disposition.user_task` },
      ],
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    const actual = run.disposition
    if (actual === null) {
      // No proposal on this run — the disposition is unknown, not different. A
      // run that produced no proposal (researcher agents, or a trace ingested
      // before the proposal is written) must not read as a failed expectation.
      return skipped(SKIP_REASON.notApplicable, { reason: 'run has no disposition' })
    }
    return {
      passed: actual === config.expected,
      score: actual === config.expected ? 1 : 0,
      evidence: { actual, expected: config.expected },
    }
  },
}

const noPiiConfig = baseConfigSchema
export type NoPiiConfig = z.infer<typeof noPiiConfig>

export const noPii: ScorerDefinition<NoPiiConfig> = {
  scorerKey: 'no_pii',
  labelKey: `${I18N}.no_pii`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: noPiiConfig,
  fields: [],
  needsExpected: () => false,
  score: (run) => {
    const text = toText(run.output)
    const detected = PII_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name)
    return {
      passed: detected.length === 0,
      score: detected.length === 0 ? 1 : 0,
      evidence: detected.length ? { detected } : undefined,
    }
  },
}

/**
 * `allowedActions` is coerced per element for the same reason `required_keys` is: a
 * whole-array `z.array(z.string())` with `.catch([])` would substitute an EMPTY list on
 * one bad element, and an empty allowlist here passes VACUOUSLY — a stored gate would
 * silently flip fail → pass, which is the one direction this assertion must never move.
 *
 * `agentType` narrows the assertion to one declared type so a suite can say "a
 * decision-maker may only propose status changes" without also constraining action
 * agents. Absent means every type.
 */
const actionVocabularyConfig = baseConfigSchema.extend({
  allowedActions: z
    .array(z.unknown())
    .catch([])
    .transform((entries) => entries.map((entry) => String(entry))),
  agentType: agentTypeSchema.optional(),
})
export type ActionVocabularyConfig = z.infer<typeof actionVocabularyConfig>

/** Every action type the run's proposal offered, across ALL options — a rejected option still proposed it. */
function proposedActionTypes(output: Json | null): string[] {
  if (output === null || typeof output !== 'object' || Array.isArray(output)) return []
  const envelope = normalizeProposalEnvelope(
    (output as Record<string, Json>).proposal ?? output,
  )
  return envelope.options.flatMap((option) => option.actions.map((action) => action.type))
}

/**
 * The eval half of the action vocabulary (spec `2026-08-11-agent-taxonomy.md`, step 9).
 *
 * The runtime check blocks an out-of-vocabulary effect at disposition time; this makes
 * the same violation VISIBLE as a failed assertion, because an agent that keeps
 * proposing actions it may not run is a prompt defect, not an execution one — the
 * blocked effect leaves no trace an operator would ever look at.
 *
 * Deliberately CONFIG-driven rather than reading the live catalogue: a scorer is pure
 * and must produce the same verdict online, in the replay engine and in the CI gate,
 * which a deployment-dependent catalogue could not.
 */
export const actionVocabulary: ScorerDefinition<ActionVocabularyConfig> = {
  scorerKey: 'action_vocabulary',
  labelKey: `${I18N}.action_vocabulary`,
  group: 'agent',
  kind: 'deterministic',
  configSchema: actionVocabularyConfig,
  fields: [
    {
      name: 'allowedActions',
      kind: 'string-list',
      labelKey: `${I18N}.action_vocabulary.field.allowedActions`,
      hintKey: `${I18N}.action_vocabulary.field.allowedActions.hint`,
      required: true,
    },
    {
      name: 'agentType',
      kind: 'select',
      labelKey: `${I18N}.action_vocabulary.field.agentType`,
      hintKey: `${I18N}.action_vocabulary.field.agentType.hint`,
      options: [
        { value: 'researcher', labelKey: `${I18N}.agentType.researcher` },
        { value: 'decision_maker', labelKey: `${I18N}.agentType.decision_maker` },
        { value: 'action', labelKey: `${I18N}.agentType.action` },
      ],
    },
  ],
  needsExpected: () => false,
  score: (run, _expected, config) => {
    if (config.agentType && run.agentType !== config.agentType) {
      return skipped(SKIP_REASON.notApplicable, { reason: 'agent type does not match', agentType: run.agentType })
    }
    const proposed = proposedActionTypes(run.output)
    if (proposed.length === 0) {
      // A run that proposed nothing cannot have proposed something forbidden. Skipping
      // rather than passing keeps a researcher run out of the pass aggregate entirely.
      return skipped(SKIP_REASON.notApplicable, { reason: 'run proposed no action' })
    }
    const allowed = new Set(config.allowedActions)
    const offending = [...new Set(proposed.filter((type) => !allowed.has(type)))]
    return {
      passed: offending.length === 0,
      score: offending.length === 0 ? 1 : 0,
      evidence: offending.length ? { offending, allowed: config.allowedActions } : undefined,
    }
  },
}

export const agentScorers = [
  outputPresent,
  requiredKeys,
  confidenceThreshold,
  dispositionEquals,
  noPii,
  actionVocabulary,
] as const
