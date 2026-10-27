import type { GuardrailCheck, IntegrityRule, ToolConsultedRule } from '../../../../data/validators'
import { formatIntegrityPath, parseIntegrityPath, readAll, removeAllAt } from '../paths'
import {
  MAX_EVIDENCE_VIOLATIONS,
  type IntegrityRuleContext,
  type IntegrityRuleOutcome,
  type IntegrityToolCall,
  type IntegrityViolation,
} from '../types'

export type ToolConsultedViolationReason = 'not_consulted'

type CitedValue = { itemPath: string; value: string }

const MAX_ARG_DEPTH = 8

function normalizeName(name: string): string {
  return name.replace(/__/g, '.')
}

function citableString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function collectCitedValues(output: unknown, path: string): CitedValue[] {
  const cited: CitedValue[] = []
  for (const { value, concretePath } of readAll(output, path)) {
    if (Array.isArray(value)) {
      value.forEach((element, elementIndex) => {
        const text = citableString(element)
        if (text !== null) cited.push({ itemPath: `${concretePath}[${elementIndex}]`, value: text })
      })
      continue
    }
    const text = citableString(value)
    if (text !== null) cited.push({ itemPath: concretePath, value: text })
  }
  return cited
}

function parseResult(result: unknown): unknown {
  if (typeof result !== 'string') return result
  const trimmed = result.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return result
  try {
    return JSON.parse(trimmed)
  } catch {
    return result
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(result: unknown): boolean {
  return isRecord(result) && result.found === false
}

function isEmptyResult(result: unknown): boolean {
  if (result === null || result === undefined) return true
  if (typeof result === 'string') return result.trim().length === 0
  if (Array.isArray(result)) return result.length === 0
  if (isRecord(result)) return Object.keys(result).length === 0
  return false
}

function returnedValues(result: unknown, paths: readonly string[]): Set<string> {
  const values = new Set<string>()
  for (const path of paths) {
    for (const { value } of readAll(result, path)) {
      const candidates = Array.isArray(value) ? value : [value]
      for (const candidate of candidates) {
        const text = citableString(candidate)
        if (text !== null) values.add(text)
      }
    }
  }
  return values
}

function collectArgLeaves(value: unknown, depth: number, into: Set<string>): void {
  if (depth > MAX_ARG_DEPTH) return
  const text = citableString(value)
  if (text !== null) {
    into.add(text)
    return
  }
  if (Array.isArray(value)) {
    for (const element of value) collectArgLeaves(element, depth + 1, into)
    return
  }
  if (isRecord(value)) {
    for (const nested of Object.values(value)) collectArgLeaves(nested, depth + 1, into)
  }
}

/**
 * Every value one tool call vouches for under the rule: values at the `returned`
 * result paths, plus — with `matchArgs` — every string/number argument leaf of a
 * call whose result was non-empty. Failed calls and `{ found: false }` results
 * vouch for nothing.
 */
function vouchedValues(call: IntegrityToolCall, rule: ToolConsultedRule): Set<string> {
  const vouched = new Set<string>()
  if (call.error) return vouched
  const result = parseResult(call.result)
  if (isNotFound(result)) return vouched
  for (const value of returnedValues(result, rule.returned)) vouched.add(value)
  if (rule.matchArgs && !isEmptyResult(result)) collectArgLeaves(call.args, 0, vouched)
  return vouched
}

function consideredCalls(ctx: IntegrityRuleContext, rule: ToolConsultedRule): IntegrityToolCall[] {
  const tools = new Set(rule.tools.map(normalizeName))
  const calls = rule.includeSubRuns ? [...ctx.toolCalls, ...(ctx.subRunToolCalls ?? [])] : ctx.toolCalls
  return calls.filter((call) => tools.has(normalizeName(call.toolName)))
}

function dropTarget(concretePath: string): string | null {
  const segments = parseIntegrityPath(concretePath)
  let lastIndex = segments.length - 1
  while (lastIndex >= 0 && segments[lastIndex].type !== 'index') lastIndex -= 1
  return lastIndex >= 0 ? formatIntegrityPath(segments.slice(0, lastIndex + 1)) : null
}

/**
 * The `tool_consulted` rule: every value cited at `cites` (strings and numbers,
 * arrays flattened, compared as strings) needs at least one successful call to a
 * tool in `tools` (`a__b` ≡ `a.b`) whose RESULT carried the value at one of the
 * `returned` paths, or — with `matchArgs` — whose arguments named it and whose
 * result was non-empty. Failed calls and `{ found: false }` results never count.
 *
 * The source of truth is the runner's in-memory tool calls, collected whenever
 * the agent declares integrity rules, independent of `OM_AGENT_TRACE_CAPTURE`.
 * `includeSubRuns` adds the calls of `delegate_agent` child runs executed by
 * the NATIVE runner in the same process (forwarded through the run context).
 * Limitation: sub-runs dispatched to another runtime (OpenCode) or another
 * process are not visible, and their persisted trace rows are not consulted.
 *
 * `onViolation`: `flag` (default) keeps the output and records it on the check
 * row (`holdsAutoApproval`); auto-approval honours it once Integrity Phase 3
 * lands — until then `flag` only records a `warn`. `drop` removes the nearest
 * enclosing array item, `block` stops the run.
 * Evidence is redacted: item paths and reason codes only, never cited values.
 */
export function evaluateToolConsulted(ctx: IntegrityRuleContext, rule: ToolConsultedRule): IntegrityRuleOutcome {
  const cited = collectCitedValues(ctx.output, rule.cites)
  const vouched = new Set<string>()
  for (const call of consideredCalls(ctx, rule)) {
    for (const value of vouchedValues(call, rule)) vouched.add(value)
  }
  const violations: IntegrityViolation[] = cited
    .filter((citation) => !vouched.has(citation.value))
    .map((citation) => ({ itemPath: citation.itemPath, reason: 'not_consulted' satisfies ToolConsultedViolationReason }))

  const blocked = violations.length > 0 && rule.onViolation === 'block'
  const dropPaths = rule.onViolation === 'drop'
    ? violations.flatMap((violation) => {
        const target = dropTarget(violation.itemPath)
        return target ? [target] : []
      })
    : []
  const output = dropPaths.length > 0 ? removeAllAt(ctx.output, dropPaths) : ctx.output
  const holdsAutoApproval = !blocked && violations.length > dropPaths.length
  const result: GuardrailCheck['result'] = blocked ? 'block' : violations.length > 0 ? 'warn' : 'pass'
  const check: GuardrailCheck = {
    kind: 'tool_consulted',
    result,
    guardrailSetVersion: ctx.guardrailSetVersion,
    evidence: {
      ruleId: rule.id,
      items: cited.length,
      violations: violations.slice(0, MAX_EVIDENCE_VIOLATIONS),
      dropped: dropPaths.length,
      repaired: 0,
      ambiguous: 0,
      ...(holdsAutoApproval ? { holdsAutoApproval: true } : {}),
    },
  }
  if (blocked) return { output: ctx.output, check, changed: false, blocked: true }
  return { output, check, changed: output !== ctx.output, blocked: false }
}

export type ToolConsultedStepOverride = { toolChoice: 'required' } | undefined

/**
 * The tool sets of every `tool_consulted` rule declared with
 * `enforce: 'prepare_step'`, normalised (`a__b` → `a.b`).
 */
export function collectEnforcedToolSets(rules: readonly IntegrityRule[]): Array<Set<string>> {
  return rules.flatMap((rule) =>
    rule.kind === 'tool_consulted' && rule.enforce === 'prepare_step'
      ? [new Set(rule.tools.map(normalizeName))]
      : [],
  )
}

/**
 * Builds the `prepareStep` behind `enforce: 'prepare_step'`: while any enforcing
 * rule has not yet seen a successful call to one of its tools, the step is
 * forced to `toolChoice: 'required'`; once each has, no override is returned and
 * the model may finish. Reads the run's live tool-call list on every step.
 */
export function buildToolConsultedPrepareStep(
  enforcedToolSets: ReadonlyArray<ReadonlySet<string>>,
  readToolCalls: () => readonly IntegrityToolCall[],
): () => ToolConsultedStepOverride {
  return () => {
    const succeeded = new Set(
      readToolCalls()
        .filter((call) => !call.error)
        .map((call) => normalizeName(call.toolName)),
    )
    const pending = enforcedToolSets.some((tools) => !Array.from(tools).some((tool) => succeeded.has(tool)))
    return pending ? { toolChoice: 'required' } : undefined
  }
}
