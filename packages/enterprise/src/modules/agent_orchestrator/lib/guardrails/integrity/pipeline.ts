import type { AwilixContainer } from 'awilix'
import type { ZodTypeAny } from 'zod'
import {
  guardrailVerdictSchema,
  type AttemptedTool,
  type GuardrailCheck,
  type GuardrailKindInput,
  type GuardrailVerdict,
  type IntegrityRule,
} from '../../../data/validators'
import type { CheckOutputArgs, GuardrailService } from '../guardrailService'
import { evaluateEvidenceQuote } from './rules/evidenceQuote'
import type {
  IntegrityRuleContext,
  IntegrityRuleEvaluator,
  IntegrityRuleOutcome,
  IntegrityRuleScope,
  IntegrityToolCall,
} from './types'

export const INTEGRITY_REPAIR_INVALID = 'integrity_repair_invalid'
export const INTEGRITY_RULE_UNSUPPORTED = 'integrity_rule_unsupported'

export type IntegrityRuleEvaluators = Partial<{
  [Kind in IntegrityRule['kind']]: IntegrityRuleEvaluator<Extract<IntegrityRule, { kind: Kind }>>
}>

export const INTEGRITY_RULE_EVALUATORS: IntegrityRuleEvaluators = {
  evidence_quote: evaluateEvidenceQuote,
}

export type OutputPipelineArgs = {
  entry: { schema: ZodTypeAny; integrity?: IntegrityRule[] }
  rawObject: unknown
  input: unknown
  toolCalls: readonly IntegrityToolCall[]
  grounding?: CheckOutputArgs['grounding']
  guardrailService: Pick<GuardrailService, 'checkOutput'>
  capability: string
  allowedTools?: string[]
  attemptedTools: AttemptedTool[]
  guardrailSetVersion: string
  scope?: IntegrityRuleScope
  container?: AwilixContainer
  evaluators?: IntegrityRuleEvaluators
  shadow?: boolean
}

export type OutputPipelineResult = {
  verdict: GuardrailVerdict
  finalOutput: unknown
  rawOutput: unknown
  changed: boolean
  changedCheckIndexes: number[]
}

export type RawOutputPointer = { key?: string; status: 'stored' | 'storage_unavailable' }

export function attachRawOutputPointer(
  verdict: GuardrailVerdict,
  changedCheckIndexes: readonly number[],
  pointer: RawOutputPointer,
): GuardrailVerdict {
  if (changedCheckIndexes.length === 0) return verdict
  const indexes = new Set(changedCheckIndexes)
  return {
    ...verdict,
    checks: verdict.checks.map((check, index) =>
      indexes.has(index) ? { ...check, evidence: { ...(check.evidence ?? {}), rawOutput: pointer } } : check,
    ),
  }
}

export function normalizeToolName(name: string): string {
  return name.replace(/__/g, '.')
}

export function integrityCheckKind(rule: IntegrityRule): GuardrailKindInput {
  return rule.kind === 'custom' ? 'custom_integrity' : rule.kind
}

function worstResult(checks: GuardrailCheck[]): GuardrailVerdict['result'] {
  if (checks.some((check) => check.result === 'block')) return 'block'
  if (checks.some((check) => check.result === 'warn')) return 'warn'
  return 'pass'
}

function buildVerdict(checks: GuardrailCheck[]): GuardrailVerdict {
  const blockedCheck = checks.find((check) => check.result === 'block')
  return guardrailVerdictSchema.parse({
    result: worstResult(checks),
    checks,
    ...(blockedCheck ? { blockedReason: { phase: 'output', kind: blockedCheck.kind } } : {}),
  })
}

async function evaluateRule(
  evaluators: IntegrityRuleEvaluators,
  ctx: IntegrityRuleContext,
  rule: IntegrityRule,
): Promise<IntegrityRuleOutcome> {
  const evaluator = evaluators[rule.kind] as IntegrityRuleEvaluator | undefined
  if (!evaluator) {
    return {
      output: ctx.output,
      changed: false,
      blocked: true,
      check: {
        kind: integrityCheckKind(rule),
        result: 'block',
        guardrailSetVersion: ctx.guardrailSetVersion,
        evidence: { ruleId: rule.id, detail: INTEGRITY_RULE_UNSUPPORTED },
      },
    }
  }
  return await evaluator(ctx, rule)
}

/**
 * Shadow mode (`OM_AGENT_INTEGRITY=off`): keeps the evaluated check but discards
 * the rule's effect. A would-be block is recorded as `warn` with `wouldBlock`, so
 * the row stays truthful about the finding without stopping the run.
 */
function toShadowOutcome(outcome: IntegrityRuleOutcome, input: unknown): IntegrityRuleOutcome {
  const evidence = Object.fromEntries(
    Object.entries(outcome.check.evidence ?? {}).filter(([key]) => key !== 'holdsAutoApproval'),
  )
  return {
    output: input,
    changed: false,
    blocked: false,
    check: {
      ...outcome.check,
      result: outcome.blocked ? 'warn' : outcome.check.result,
      evidence: { ...evidence, shadow: true, ...(outcome.blocked ? { wouldBlock: true } : {}) },
    },
  }
}

/**
 * The output pipeline (spec `2026-10-21-output-integrity-guardrails` → Pipeline
 * order): 1 schema on the raw object, 2 integrity rules in declaration order
 * (each on an immutable copy of the previous output), 3 schema re-validation of
 * the repaired output, 4 grounding and 6 `tool_scope` (with the run's attempted
 * tools) on the final output. Reuses `checkOutput` for steps 1, 4 and 6 and
 * folds every check into one verdict; it never persists anything. With `shadow`
 * every rule is evaluated and recorded but the raw output stays final.
 */
export async function runOutputPipeline(args: OutputPipelineArgs): Promise<OutputPipelineResult> {
  const rawOutput = args.rawObject
  const rawVerdict = await args.guardrailService.checkOutput({
    capability: args.capability,
    schema: args.entry.schema,
    output: rawOutput,
  })
  const schemaChecks = rawVerdict.checks.filter((check) => check.kind === 'schema')
  if (schemaChecks.some((check) => check.result === 'block')) {
    return {
      verdict: buildVerdict(schemaChecks),
      finalOutput: rawOutput,
      rawOutput,
      changed: false,
      changedCheckIndexes: [],
    }
  }

  const evaluators = args.evaluators ?? INTEGRITY_RULE_EVALUATORS
  const integrityChecks: GuardrailCheck[] = []
  let current: unknown = structuredClone(rawOutput)
  let changed = false
  const changedCheckIndexes: number[] = []
  for (const rule of args.entry.integrity ?? []) {
    const evaluated = await evaluateRule(
      evaluators,
      {
        output: structuredClone(current),
        input: args.input,
        toolCalls: args.toolCalls,
        guardrailSetVersion: args.guardrailSetVersion,
        ...(args.scope ? { scope: args.scope } : {}),
        ...(args.container ? { container: args.container } : {}),
      },
      rule,
    )
    const outcome = args.shadow ? toShadowOutcome(evaluated, current) : evaluated
    integrityChecks.push(outcome.check)
    if (outcome.blocked) {
      return {
        verdict: buildVerdict([...schemaChecks, ...integrityChecks]),
        finalOutput: rawOutput,
        rawOutput,
        changed: false,
        changedCheckIndexes: [],
      }
    }
    if (outcome.changed) {
      current = outcome.output
      changed = true
      changedCheckIndexes.push(schemaChecks.length + integrityChecks.length - 1)
    }
  }
  const finalOutput = changed ? current : rawOutput

  if (changed && !args.entry.schema.safeParse(finalOutput).success) {
    const repairCheck: GuardrailCheck = {
      kind: 'schema',
      result: 'block',
      guardrailSetVersion: schemaChecks[0]?.guardrailSetVersion ?? args.guardrailSetVersion,
      evidence: { detail: INTEGRITY_REPAIR_INVALID },
    }
    return {
      verdict: buildVerdict([...schemaChecks, ...integrityChecks, repairCheck]),
      finalOutput,
      rawOutput,
      changed,
      changedCheckIndexes,
    }
  }

  const finalVerdict = await args.guardrailService.checkOutput({
    capability: args.capability,
    schema: args.entry.schema,
    output: finalOutput,
    allowedTools: args.allowedTools,
    attemptedTools: args.attemptedTools,
    grounding: args.grounding,
  })
  const finalChecks = finalVerdict.checks.filter((check) => check.kind !== 'schema')
  return {
    verdict: buildVerdict([...schemaChecks, ...integrityChecks, ...finalChecks]),
    finalOutput,
    rawOutput,
    changed,
    changedCheckIndexes,
  }
}
