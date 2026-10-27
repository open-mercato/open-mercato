import type { EvidenceQuoteRule, GuardrailCheck } from '../../../../data/validators'
import { codepointToUtf16Offset, findQuote, graphemeLength } from '../normalize'
import {
  IntegrityPathError,
  isValidIntegrityPath,
  parseIntegrityPath,
  readAll,
  removeAllAt,
  writeAt,
  type IntegrityPathSegment,
} from '../paths'
import {
  MAX_EVIDENCE_VIOLATIONS,
  type IntegrityRuleContext,
  type IntegrityRuleOutcome,
  type IntegrityViolation,
} from '../types'

export type EvidenceQuoteViolationReason = 'quote_missing' | 'source_missing' | 'too_short' | 'not_found'

type ItemVerdict =
  | { kind: 'violation'; reason: EvidenceQuoteViolationReason }
  | { kind: 'match'; quote: { segments: IntegrityPathSegment[]; value: string }; source: string; start: number; end: number; ambiguous: boolean; claimedStart: unknown; claimedEnd: unknown }

function firstMatch(value: unknown, path: string): { value: unknown; segments: IntegrityPathSegment[] } | null {
  const [match] = readAll(value, path)
  if (!match) return null
  return { value: match.value, segments: match.concretePath ? parseIntegrityPath(match.concretePath) : [] }
}

function readValue(value: unknown, path: string): unknown {
  return firstMatch(value, path)?.value
}

function resolveSource(ctx: IntegrityRuleContext, rule: EvidenceQuoteRule, item: unknown): string | null {
  if ('input' in rule.source) {
    const source = readValue(ctx.input, rule.source.input)
    return typeof source === 'string' ? source : null
  }
  const inputPath = readValue(item, rule.source.fromItem)
  if (typeof inputPath !== 'string' || !isValidIntegrityPath(inputPath)) return null
  const source = readValue(ctx.input, inputPath)
  return typeof source === 'string' ? source : null
}

function evaluateItem(ctx: IntegrityRuleContext, rule: EvidenceQuoteRule, item: unknown): ItemVerdict {
  const quoteMatch = firstMatch(item, rule.quote)
  if (!quoteMatch || typeof quoteMatch.value !== 'string') return { kind: 'violation', reason: 'quote_missing' }
  const source = resolveSource(ctx, rule, item)
  if (source === null) return { kind: 'violation', reason: 'source_missing' }
  if (graphemeLength(quoteMatch.value.trim(), rule.locale) < rule.minChars) return { kind: 'violation', reason: 'too_short' }
  const claimedStart = rule.offsets ? readValue(item, rule.offsets.start) : undefined
  const claimedEnd = rule.offsets ? readValue(item, rule.offsets.end) : undefined
  const found = findQuote(source, quoteMatch.value, {
    normalize: rule.normalize,
    caseInsensitive: rule.caseInsensitive,
    locale: rule.locale,
    offsetUnit: rule.offsetUnit,
    hintStart: typeof claimedStart === 'number' && Number.isFinite(claimedStart) ? claimedStart : undefined,
  })
  if (!found.found) return { kind: 'violation', reason: 'not_found' }
  return {
    kind: 'match',
    quote: { segments: quoteMatch.segments, value: quoteMatch.value },
    source,
    start: found.start,
    end: found.end,
    ambiguous: found.ambiguous,
    claimedStart,
    claimedEnd,
  }
}

function writeRelative(output: unknown, itemSegments: IntegrityPathSegment[], relative: IntegrityPathSegment[], value: unknown): unknown {
  return writeAt(output, [...itemSegments, ...relative], value)
}

function writeOffset(output: unknown, itemSegments: IntegrityPathSegment[], path: string, value: number): unknown {
  try {
    return writeRelative(output, itemSegments, parseIntegrityPath(path), value)
  } catch (error) {
    if (error instanceof IntegrityPathError) return output
    throw error
  }
}

function canonicalSlice(rule: EvidenceQuoteRule, source: string, start: number, end: number): string {
  if (rule.offsetUnit === 'codepoint') {
    return source.slice(codepointToUtf16Offset(source, start), codepointToUtf16Offset(source, end))
  }
  return source.slice(start, end)
}

function isDroppable(concretePath: string): boolean {
  const segments = parseIntegrityPath(concretePath)
  return segments.length > 0 && segments[segments.length - 1].type === 'index'
}

/**
 * The `evidence_quote` rule: every item at `items` must quote its source. Offsets
 * are never trusted — they are recomputed and written back, and a disagreement
 * counts as a repair. `repair` cannot fix a quote that is not in the source, so a
 * miss under `onViolation: 'repair'` is kept and flagged exactly like `flag`.
 * Evidence is redacted: counts and item paths only, never quote or input text.
 */
export function evaluateEvidenceQuote(ctx: IntegrityRuleContext, rule: EvidenceQuoteRule): IntegrityRuleOutcome {
  const items = readAll(ctx.output, rule.items)
  const violations: IntegrityViolation[] = []
  const dropPaths: string[] = []
  let output = ctx.output
  let repaired = 0
  let ambiguous = 0

  for (const { value: item, concretePath } of items) {
    const verdict = evaluateItem(ctx, rule, item)
    if (verdict.kind === 'violation') {
      violations.push({ itemPath: concretePath, reason: verdict.reason })
      if (rule.onViolation === 'drop' && isDroppable(concretePath)) dropPaths.push(concretePath)
      continue
    }
    if (verdict.ambiguous) ambiguous += 1
    const itemSegments = parseIntegrityPath(concretePath)
    let itemRepaired = false
    if (rule.offsets && (verdict.claimedStart !== verdict.start || verdict.claimedEnd !== verdict.end)) {
      itemRepaired = true
      output = writeOffset(output, itemSegments, rule.offsets.start, verdict.start)
      output = writeOffset(output, itemSegments, rule.offsets.end, verdict.end)
    }
    if (rule.repairQuote) {
      const canonical = canonicalSlice(rule, verdict.source, verdict.start, verdict.end)
      if (canonical !== verdict.quote.value) {
        itemRepaired = true
        output = writeRelative(output, itemSegments, verdict.quote.segments, canonical)
      }
    }
    if (itemRepaired) repaired += 1
  }

  const blocked = violations.length > 0 && rule.onViolation === 'block'
  if (dropPaths.length > 0 && !blocked) output = removeAllAt(output, dropPaths)
  const holdsAutoApproval = !blocked && violations.length > dropPaths.length
  const result: GuardrailCheck['result'] = blocked
    ? 'block'
    : violations.length > 0 || repaired > 0
      ? 'warn'
      : 'pass'
  const check: GuardrailCheck = {
    kind: 'evidence_quote',
    result,
    guardrailSetVersion: ctx.guardrailSetVersion,
    evidence: {
      ruleId: rule.id,
      items: items.length,
      violations: violations.slice(0, MAX_EVIDENCE_VIOLATIONS),
      dropped: blocked ? 0 : dropPaths.length,
      repaired,
      ambiguous,
      ...(holdsAutoApproval ? { holdsAutoApproval: true } : {}),
    },
  }
  if (blocked) return { output: ctx.output, check, changed: false, blocked: true }
  return { output, check, changed: output !== ctx.output, blocked: false }
}
