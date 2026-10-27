import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CustomIntegrityRule, GuardrailCheck } from '../../../../data/validators'
import { getIntegrityChecker } from '../../../sdk/integrityCheckers'
import { formatIntegrityPath, parseIntegrityPath, readAll, removeAllAt } from '../paths'
import {
  MAX_EVIDENCE_VIOLATIONS,
  type IntegrityRuleContext,
  type IntegrityRuleOutcome,
  type IntegrityViolation,
} from '../types'

const logger = createLogger('agent_orchestrator').child({ component: 'integrity-custom' })

export const CUSTOM_CHECKER_MISSING = 'checker_missing'
export const CUSTOM_CHECKER_ERROR = 'checker_error'
export const CUSTOM_INVALID_REASON = 'invalid_reason'
export const CUSTOM_UNADDRESSABLE_PATH = '$'

const REASON_CODE_PATTERN = /^[a-z0-9_.:-]{1,64}$/
const MAX_ITEM_PATH_LENGTH = 500

const checkerResultSchema = z.object({
  violations: z.array(z.object({ itemPath: z.unknown(), reason: z.unknown() })),
  repairedOutput: z.unknown().optional(),
})

function sanitizeReason(reason: unknown): string {
  return typeof reason === 'string' && REASON_CODE_PATTERN.test(reason) ? reason : CUSTOM_INVALID_REASON
}

function isConcretePath(path: string): boolean {
  try {
    return parseIntegrityPath(path).every((segment) => segment.type !== 'wildcard')
  } catch {
    return false
  }
}

function sanitizeItemPath(itemPath: unknown): string {
  if (typeof itemPath !== 'string' || itemPath.length > MAX_ITEM_PATH_LENGTH) return CUSTOM_UNADDRESSABLE_PATH
  return isConcretePath(itemPath) ? itemPath : CUSTOM_UNADDRESSABLE_PATH
}

function dropTarget(output: unknown, itemPath: string): string | null {
  if (itemPath === CUSTOM_UNADDRESSABLE_PATH) return null
  const segments = parseIntegrityPath(itemPath)
  let lastIndex = segments.length - 1
  while (lastIndex >= 0 && segments[lastIndex].type !== 'index') lastIndex -= 1
  if (lastIndex < 0) return null
  const target = formatIntegrityPath(segments.slice(0, lastIndex + 1))
  return readAll(output, target).length === 1 ? target : null
}

function failureOutcome(ctx: IntegrityRuleContext, rule: CustomIntegrityRule, detail: string): IntegrityRuleOutcome {
  return {
    output: ctx.output,
    changed: false,
    blocked: true,
    check: {
      kind: 'custom_integrity',
      result: 'block',
      guardrailSetVersion: ctx.guardrailSetVersion,
      evidence: {
        ruleId: rule.id,
        checker: rule.checker,
        items: 0,
        violations: [],
        dropped: 0,
        repaired: 0,
        ambiguous: 0,
        detail,
      },
    },
  }
}

function reportCheckerFailure(rule: CustomIntegrityRule, error: unknown): void {
  logger.warn('integrity checker failed', {
    ruleId: rule.id,
    checker: rule.checker,
    error: error instanceof Error ? error.message : String(error),
  })
  getTelemetryRuntime()?.reportError(error, {
    module: 'agent_orchestrator',
    code: 'agent_orchestrator.integrity_checker_failed',
    attributes: { ruleId: rule.id, checker: rule.checker },
  })
}

/**
 * The `custom` rule: runs the checker registered under `rule.checker` through
 * `registerIntegrityChecker` with private copies of the output and input, the
 * run's tool calls, its citable sources, the scope, the container and the
 * rule's `config`.
 *
 * - An unregistered checker blocks with `checker_missing` (resolved at run time
 *   only: module load order is undefined, so registration never requires it).
 * - A checker that throws or returns a malformed result is a failure of the
 *   checker, not a finding about the output: the run blocks with
 *   `checker_error` regardless of `onViolation`, and the error is logged and
 *   reported (never written to evidence).
 * - `repairedOutput` replaces the output (`changed`); the pipeline re-validates
 *   it against the result schema. Violations are then read against it.
 * - Violations follow `onViolation`: `flag` holds auto-approval, `drop` removes
 *   the nearest enclosing array item (unaddressable paths stay flagged),
 *   `block` stops the run.
 *
 * Reasons must be codes (`^[a-z0-9_.:-]{1,64}$`); anything else is recorded as
 * `invalid_reason` and a malformed item path as `$`, so checker free text never
 * reaches a check row. Evidence: rule id, checker id, ≤ 20 violations, counts.
 */
export async function evaluateCustomIntegrity(
  ctx: IntegrityRuleContext,
  rule: CustomIntegrityRule,
): Promise<IntegrityRuleOutcome> {
  const checker = getIntegrityChecker(rule.checker)
  if (!checker) return failureOutcome(ctx, rule, CUSTOM_CHECKER_MISSING)

  let violations: IntegrityViolation[]
  let repairedOutput: { value: unknown } | null
  try {
    const raw = await checker({
      output: structuredClone(ctx.output),
      input: structuredClone(ctx.input),
      toolCalls: ctx.toolCalls,
      citableSources: ctx.citableSources ?? [],
      ...(ctx.scope ? { scope: ctx.scope } : {}),
      ...(ctx.container ? { container: ctx.container } : {}),
      ...(rule.config ? { config: structuredClone(rule.config) } : {}),
    })
    const parsed = checkerResultSchema.safeParse(raw)
    if (!parsed.success) throw new Error('[internal] integrity checker returned a malformed result')
    violations = parsed.data.violations.map((violation) => ({
      itemPath: sanitizeItemPath(violation.itemPath),
      reason: sanitizeReason(violation.reason),
    }))
    repairedOutput = parsed.data.repairedOutput !== undefined
      ? { value: structuredClone(parsed.data.repairedOutput) }
      : null
  } catch (error) {
    reportCheckerFailure(rule, error)
    return failureOutcome(ctx, rule, CUSTOM_CHECKER_ERROR)
  }

  const base = repairedOutput ? repairedOutput.value : ctx.output
  const blocked = violations.length > 0 && rule.onViolation === 'block'
  const dropPaths = rule.onViolation === 'drop' && !blocked
    ? violations.flatMap((violation) => {
        const target = dropTarget(base, violation.itemPath)
        return target ? [target] : []
      })
    : []
  const output = dropPaths.length > 0 ? removeAllAt(base, dropPaths) : base
  const holdsAutoApproval = !blocked && violations.length > dropPaths.length
  const result: GuardrailCheck['result'] = blocked ? 'block' : violations.length > 0 ? 'warn' : 'pass'
  const check: GuardrailCheck = {
    kind: 'custom_integrity',
    result,
    guardrailSetVersion: ctx.guardrailSetVersion,
    evidence: {
      ruleId: rule.id,
      checker: rule.checker,
      items: violations.length,
      violations: violations.slice(0, MAX_EVIDENCE_VIOLATIONS),
      dropped: dropPaths.length,
      repaired: repairedOutput ? 1 : 0,
      ambiguous: 0,
      ...(holdsAutoApproval ? { holdsAutoApproval: true } : {}),
    },
  }
  if (blocked) return { output: ctx.output, check, changed: false, blocked: true }
  return { output, check, changed: output !== ctx.output, blocked: false }
}
