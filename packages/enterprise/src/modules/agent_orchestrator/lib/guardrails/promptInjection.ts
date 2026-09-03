import type { GuardrailEvidence } from '../../data/validators'
import { type UntrustedSpan } from '../../data/validators'

/**
 * Deterministic prompt-injection detector (Wave 3, Phase 3 — GAP-08 layer 2).
 *
 * Pure/offline heuristic over UNTRUSTED `document`/`retrieval` spans assembled by
 * the Wave-2 ContextResolver. It is NOT the security boundary — that is the
 * always-on tool-scope allowlist + mutation-policy backstop ("LLM proposes, OM
 * disposes"). This layer is a SIGNAL: it raises a per-span risk score from
 * injection-instruction patterns, encoded-payload heuristics, and suspicious-token
 * density, mapped to `warn`/`block` by conservative thresholds.
 *
 * Evidence is POINTERS ONLY — the span's provenance locator + the matched
 * pattern-rule ids + offsets. The raw untrusted text NEVER enters evidence (the
 * full payload stays in the encrypted artifact store; this records what was hit,
 * not the hit's content).
 */

export type InjectionRiskResult = 'pass' | 'warn' | 'block'

/** Pattern-rule ids surfaced in evidence (stable, redaction-safe — no raw text). */
export const INJECTION_RULE = {
  instructionOverride: 'instruction_override',
  roleImpersonation: 'role_impersonation',
  toolDirective: 'tool_directive',
  encodedPayload: 'encoded_payload',
  obfuscatedSpacing: 'obfuscated_spacing',
  tokenDensity: 'token_density',
} as const

export type InjectionRuleId = (typeof INJECTION_RULE)[keyof typeof INJECTION_RULE]

/**
 * Conservative, `warn`-biased thresholds (GAP-08 §5 default: ship deterministic at
 * conservative thresholds; the model judge stays dark-launched). A single
 * high-signal hit (instruction-override / tool-directive) blocks; lower-signal hits
 * accumulate to `warn`.
 */
export const INJECTION_BLOCK_SCORE = 3
export const INJECTION_WARN_SCORE = 1

/** Per-rule risk weights. High-signal directives weigh enough to block alone. */
const RULE_WEIGHT: Record<InjectionRuleId, number> = {
  [INJECTION_RULE.instructionOverride]: 3,
  [INJECTION_RULE.toolDirective]: 3,
  [INJECTION_RULE.roleImpersonation]: 2,
  [INJECTION_RULE.encodedPayload]: 1,
  [INJECTION_RULE.obfuscatedSpacing]: 1,
  [INJECTION_RULE.tokenDensity]: 1,
}

/**
 * Injection-instruction patterns. Deliberately high-precision (anchored on
 * imperative verbs that target the model's prior instructions / role / tools) to
 * keep false positives on benign imperative claim language low. Each entry maps to
 * a redaction-safe rule id, never the matched text.
 */
const INSTRUCTION_PATTERNS: Array<{ rule: InjectionRuleId; pattern: RegExp }> = [
  {
    rule: INJECTION_RULE.instructionOverride,
    pattern:
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(previous|prior|above|earlier|all|system|prompt|instruction|instructions|context|rule|rules|guardrail|guardrails)\b/i,
  },
  {
    rule: INJECTION_RULE.roleImpersonation,
    pattern:
      /(^|\n)\s*(system|developer|assistant)\s*[:>\]]|\byou are now\b|\bact as\b[^.!?\n]{0,40}\b(admin|system|root|developer)\b|\bnew (instructions?|system prompt)\b/i,
  },
  {
    rule: INJECTION_RULE.toolDirective,
    pattern:
      /\b(call|invoke|execute|run|use|trigger)\b[^.!?\n]{0,40}\b(tool|function|api|command|action|endpoint)\b/i,
  },
  {
    rule: INJECTION_RULE.toolDirective,
    // High-value financial/state-changing actions stated imperatively (the named
    // "approve and pay out" attack) — these never legitimately INSTRUCT an agent
    // from inside untrusted document content.
    pattern: /\b(approve|pay\s?out|payout|transfer|refund|wire|delete|disburse|authorize)\b/i,
  },
]

/** Encoded-payload heuristics (base64-ish / long hex / data-uri) — evasion vectors. */
const ENCODED_PATTERNS: Array<{ rule: InjectionRuleId; pattern: RegExp }> = [
  { rule: INJECTION_RULE.encodedPayload, pattern: /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i },
  { rule: INJECTION_RULE.encodedPayload, pattern: /[A-Za-z0-9+/]{40,}={0,2}/ },
  { rule: INJECTION_RULE.encodedPayload, pattern: /(?:[0-9a-f]{2}\s?){24,}/i },
]

/**
 * Letter-spacing obfuscation ("i g n o r e"): a run of single chars separated by
 * spaces, a classic regex-evasion of the instruction patterns above.
 */
const OBFUSCATED_SPACING = /(?:\b\w\b[ \t]){5,}\b\w\b/

/** Non-word symbol density — high density flags markup/role-header mimicry. */
const TOKEN_DENSITY_THRESHOLD = 0.32
const TOKEN_DENSITY_MIN_LENGTH = 40

/** One span's verdict: redaction-safe rule ids + the score they summed to. */
export type SpanInjectionVerdict = {
  span: UntrustedSpan
  rules: InjectionRuleId[]
  score: number
  result: InjectionRiskResult
}

function symbolDensity(text: string): number {
  if (text.length < TOKEN_DENSITY_MIN_LENGTH) return 0
  const symbols = text.replace(/[\w\s]/g, '').length
  return symbols / text.length
}

/** Map an accumulated score to a verdict via the conservative thresholds. */
export function scoreToResult(score: number): InjectionRiskResult {
  if (score >= INJECTION_BLOCK_SCORE) return 'block'
  if (score >= INJECTION_WARN_SCORE) return 'warn'
  return 'pass'
}

/**
 * Detect injected-instruction patterns in ONE untrusted span. Returns the matched
 * rule ids (redaction-safe), the summed risk score, and the mapped verdict. Pure —
 * no model calls, no I/O. The raw text is read but never returned.
 */
export function detectSpanInjection(span: UntrustedSpan): SpanInjectionVerdict {
  const text = span.text
  const matched = new Set<InjectionRuleId>()

  for (const { rule, pattern } of INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) matched.add(rule)
  }
  for (const { rule, pattern } of ENCODED_PATTERNS) {
    if (pattern.test(text)) matched.add(rule)
  }
  if (OBFUSCATED_SPACING.test(text)) matched.add(INJECTION_RULE.obfuscatedSpacing)
  if (symbolDensity(text) >= TOKEN_DENSITY_THRESHOLD) matched.add(INJECTION_RULE.tokenDensity)

  const rules = [...matched]
  const score = rules.reduce((sum, rule) => sum + RULE_WEIGHT[rule], 0)
  return { span, rules, score, result: scoreToResult(score) }
}

/**
 * Build the redacted, POINTER-ONLY evidence for an injection hit. Carries the
 * span's provenance locator (a pointer into the source document / artifact store)
 * and the matched rule ids — NEVER the raw untrusted text. `detail` is a stable,
 * payload-free summary safe for the trace inspector.
 */
export function injectionEvidence(verdicts: SpanInjectionVerdict[]): GuardrailEvidence {
  const flagged = verdicts.filter((verdict) => verdict.result !== 'pass')
  const pointers = flagged.map(
    (verdict) => `${verdict.span.sourceKind}:${verdict.span.sourceRef}@${verdict.span.locator}`,
  )
  const rules = [...new Set(flagged.flatMap((verdict) => verdict.rules))]
  return {
    detail: `prompt_injection: ${flagged.length} untrusted span(s) flagged [${rules.join(',')}]`,
    pointers,
    rules,
    flaggedSpans: flagged.length,
  }
}
