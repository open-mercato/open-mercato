import type { AwilixContainer } from 'awilix'
import type { CitableSource } from '../../data/validators'
import type { IntegrityRuleScope, IntegrityToolCall } from '../guardrails/integrity/types'

/**
 * Custom output-integrity checkers (spec `2026-10-21-output-integrity-guardrails`
 * → Rule kinds → `custom`). App modules register a checker under a stable
 * `<module>.<name>` id and reference it from `defineAgent({ integrity: [{ kind:
 * 'custom', checker }] })`, so domain rules run INSIDE the output pipeline and
 * gate disposition. The checker must be registered before the agent RUNS, not
 * before it is defined — module load order is undefined, so a checker missing at
 * run time blocks the run with `checker_missing` instead of failing registration.
 */
export type IntegrityCheckerInput = {
  /** A private copy of the current result envelope (after earlier rules). */
  output: unknown
  /** A private copy of the run input. */
  input: unknown
  /** In-memory tool calls of the run, in call order. */
  toolCalls: readonly IntegrityToolCall[]
  /** Citable sources assembled for the run's context bundle (empty when none). */
  citableSources: readonly CitableSource[]
  scope?: IntegrityRuleScope
  container?: AwilixContainer
  /** The rule's declared `config`, when any. */
  config?: Record<string, unknown>
}

export type IntegrityCheckerViolation = {
  /** Concrete path of the offending item, relative to the result (`data.items[2]`). */
  itemPath: string
  /** A stable reason CODE (`^[a-z0-9_.:-]{1,64}$`), never free text. */
  reason: string
}

export type IntegrityCheckerResult = {
  violations: IntegrityCheckerViolation[]
  /** A repaired envelope; it replaces the output and is re-validated against the result schema. */
  repairedOutput?: unknown
}

export type IntegrityCheckerFn = (
  input: IntegrityCheckerInput,
) => IntegrityCheckerResult | Promise<IntegrityCheckerResult>

export const INTEGRITY_CHECKER_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_.-]*$/
export const INTEGRITY_CHECKER_ID_MAX_LENGTH = 200

const checkers = new Map<string, IntegrityCheckerFn>()

export function registerIntegrityChecker(checkerId: string, fn: IntegrityCheckerFn): void {
  if (
    typeof checkerId !== 'string' ||
    checkerId.length > INTEGRITY_CHECKER_ID_MAX_LENGTH ||
    !INTEGRITY_CHECKER_ID_PATTERN.test(checkerId)
  ) {
    throw new Error(`[internal] invalid integrity checker id "${String(checkerId)}" (expected "<module>.<name>")`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`[internal] integrity checker "${checkerId}" must be a function`)
  }
  if (checkers.has(checkerId)) {
    throw new Error(`[internal] duplicate integrity checker id "${checkerId}"`)
  }
  checkers.set(checkerId, fn)
}

export function getIntegrityChecker(checkerId: string): IntegrityCheckerFn | undefined {
  return checkers.get(checkerId)
}

export function resetIntegrityCheckersForTests(): void {
  checkers.clear()
}
