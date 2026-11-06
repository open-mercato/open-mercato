import type { AbstainOrReviewRule, AbstainOrReviewSignal, GuardrailCheck, IntegrityEvidence } from '../../../../data/validators'
import { IntegrityPathError, readAll, writeAt } from '../paths'
import { INTEGRITY_REPAIR_INVALID, type IntegrityRuleContext, type IntegrityRuleOutcome } from '../types'

export type AbstainOrReviewOutcome = NonNullable<IntegrityEvidence['outcome']>

type SignalVerdict = { fired: boolean; reasons: string[] }

type PriorRuleTally = { ruleId: string; items: number; dropped: number; violations: number }

const NOT_FIRED: SignalVerdict = { fired: false, reasons: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.keys(value).length === 0
  return false
}

function parseToolResult(result: unknown): unknown {
  if (typeof result !== 'string') return result
  const trimmed = result.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return result
  try {
    return JSON.parse(trimmed)
  } catch {
    return result
  }
}

function isEmptyToolResult(result: unknown): boolean {
  const parsed = parseToolResult(result)
  if (isEmptyValue(parsed)) return true
  if (!isRecord(parsed)) return false
  if (parsed.found === false) return true
  const lists = Object.values(parsed).filter((value) => Array.isArray(value))
  return lists.length > 0 && lists.every((list) => isEmptyValue(list))
}

function normalizeToolName(name: string): string {
  return name.replace(/__/g, '.')
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function tallyPriorRules(priorChecks: readonly GuardrailCheck[]): PriorRuleTally[] {
  const tallies: PriorRuleTally[] = []
  for (const check of priorChecks) {
    const evidence = check.evidence
    if (!evidence || typeof evidence.ruleId !== 'string') continue
    const violationList = Array.isArray(evidence.violations) ? evidence.violations.length : 0
    const dropped = countOf(evidence.dropped)
    tallies.push({
      ruleId: evidence.ruleId,
      items: countOf(evidence.items),
      dropped,
      violations: Math.max(violationList, dropped),
    })
  }
  return tallies
}

function evaluateSignal(ctx: IntegrityRuleContext, signal: AbstainOrReviewSignal, tallies: PriorRuleTally[]): SignalVerdict {
  switch (signal.signal) {
    case 'output_empty': {
      const matches = readAll(ctx.output, signal.path)
      return matches.every((match) => isEmptyValue(match.value)) ? { fired: true, reasons: [signal.signal] } : NOT_FIRED
    }
    case 'tool_returned_empty': {
      const target = normalizeToolName(signal.tool)
      const calls = ctx.toolCalls.filter((call) => normalizeToolName(call.toolName) === target)
      const fired = calls.length > 0 && calls.every((call) => Boolean(call.error) || isEmptyToolResult(call.result))
      return fired ? { fired: true, reasons: [signal.signal] } : NOT_FIRED
    }
    case 'retrieval_empty':
      return (ctx.citableSources?.length ?? 0) === 0 ? { fired: true, reasons: [signal.signal] } : NOT_FIRED
    case 'confidence_below': {
      const fired = readAll(ctx.output, signal.path).some(
        (match) => typeof match.value === 'number' && Number.isFinite(match.value) && match.value < signal.threshold,
      )
      return fired ? { fired: true, reasons: [signal.signal] } : NOT_FIRED
    }
    case 'violations_at_least': {
      const scoped = signal.rules ? new Set(signal.rules) : null
      const contributing = tallies.filter((tally) => tally.violations > 0 && (!scoped || scoped.has(tally.ruleId)))
      const total = contributing.reduce((sum, tally) => sum + tally.violations, 0)
      return total >= signal.count
        ? { fired: true, reasons: [signal.signal, ...contributing.map((tally) => tally.ruleId)] }
        : NOT_FIRED
    }
    case 'output_flag':
      return readAll(ctx.output, signal.path).some((match) => match.value === true)
        ? { fired: true, reasons: [signal.signal] }
        : NOT_FIRED
    case 'integrity_dropped_all': {
      const fired = tallies.some((tally) => tally.ruleId === signal.rule && tally.items > 0 && tally.dropped >= tally.items)
      return fired ? { fired: true, reasons: [signal.signal, signal.rule] } : NOT_FIRED
    }
  }
}

function evaluateWhen(ctx: IntegrityRuleContext, when: readonly AbstainOrReviewSignal[], tallies: PriorRuleTally[]): SignalVerdict {
  const reasons: string[] = []
  for (const signal of when) {
    const verdict = evaluateSignal(ctx, signal, tallies)
    if (verdict.fired) reasons.push(...verdict.reasons)
  }
  return reasons.length > 0 ? { fired: true, reasons: Array.from(new Set(reasons)) } : NOT_FIRED
}

function applySet(output: unknown, set: Record<string, unknown>): unknown {
  return Object.entries(set).reduce<unknown>((current, [path, value]) => writeAt(current, path, structuredClone(value)), output)
}

function ruleEvidence(rule: AbstainOrReviewRule, outcome: AbstainOrReviewOutcome): IntegrityEvidence {
  return { ruleId: rule.id, items: 0, violations: [], dropped: 0, repaired: 0, ambiguous: 0, outcome }
}

function blockedOutcome(ctx: IntegrityRuleContext, rule: AbstainOrReviewRule, outcome: AbstainOrReviewOutcome): IntegrityRuleOutcome {
  return {
    output: ctx.output,
    changed: false,
    blocked: true,
    check: {
      kind: 'abstain_or_review',
      result: 'block',
      guardrailSetVersion: ctx.guardrailSetVersion,
      evidence: { ...ruleEvidence(rule, outcome), detail: INTEGRITY_REPAIR_INVALID },
    },
  }
}

/**
 * The `abstain_or_review` rule, evaluated after every other integrity rule and
 * after grounding, so `ctx.priorChecks` carries every earlier verdict. Signals are
 * any-of; `needsReview` wins over `notApplicable` (a run whose evidence was all
 * invented must reach a human, not read as "nothing applies"). Not applicable is
 * a `pass` — abstaining is a correct answer. Needs review is a `warn` that holds
 * auto-approval, writes stable reason codes (signal names and rule ids, never
 * input text) at `reasonsPath`, and asks the pipeline for a review request on its
 * `route`. A `set` that cannot be written is a block (`integrity_repair_invalid`);
 * the pipeline re-validates whatever is written against the result schema.
 * `violations_at_least` counts each earlier rule's violations (its recorded list,
 * capped at 20, or its exact drop count when larger). A tool result is empty when
 * it is blank, `{ found: false }`, or a record whose every array is empty (a
 * retrieval page with no hits); failed calls count as empty.
 */
export function evaluateAbstainOrReview(ctx: IntegrityRuleContext, rule: AbstainOrReviewRule): IntegrityRuleOutcome {
  const tallies = tallyPriorRules(ctx.priorChecks ?? [])
  const review = rule.needsReview ? evaluateWhen(ctx, rule.needsReview.when, tallies) : NOT_FIRED
  if (rule.needsReview && review.fired) {
    const reasonsPath = rule.needsReview.reasonsPath
    let output: unknown
    try {
      const withSet = applySet(ctx.output, rule.needsReview.set)
      output = reasonsPath ? writeAt(withSet, reasonsPath, [...review.reasons]) : withSet
    } catch (error) {
      if (error instanceof IntegrityPathError) return blockedOutcome(ctx, rule, 'needs_review')
      throw error
    }
    return {
      output,
      changed: output !== ctx.output,
      blocked: false,
      reviewRequest: { ruleId: rule.id, route: rule.needsReview.route, reasons: review.reasons },
      check: {
        kind: 'abstain_or_review',
        result: 'warn',
        guardrailSetVersion: ctx.guardrailSetVersion,
        evidence: {
          ...ruleEvidence(rule, 'needs_review'),
          reasons: review.reasons,
          route: rule.needsReview.route,
          holdsAutoApproval: true,
        },
      },
    }
  }
  const notApplicable = rule.notApplicable ? evaluateWhen(ctx, rule.notApplicable.when, tallies) : NOT_FIRED
  if (rule.notApplicable && notApplicable.fired) {
    let output: unknown
    try {
      output = applySet(ctx.output, rule.notApplicable.set)
    } catch (error) {
      if (error instanceof IntegrityPathError) return blockedOutcome(ctx, rule, 'not_applicable')
      throw error
    }
    return {
      output,
      changed: output !== ctx.output,
      blocked: false,
      check: {
        kind: 'abstain_or_review',
        result: 'pass',
        guardrailSetVersion: ctx.guardrailSetVersion,
        evidence: { ...ruleEvidence(rule, 'not_applicable'), reasons: notApplicable.reasons },
      },
    }
  }
  return {
    output: ctx.output,
    changed: false,
    blocked: false,
    check: {
      kind: 'abstain_or_review',
      result: 'pass',
      guardrailSetVersion: ctx.guardrailSetVersion,
      evidence: ruleEvidence(rule, 'none'),
    },
  }
}
