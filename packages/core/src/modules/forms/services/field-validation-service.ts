/**
 * Pure field-level validation service for the Forms Tier-2 question palette
 * (`.ai/specs/2026-05-14-forms-tier-2-question-palette.md`).
 *
 * Compiled at AJV-compile time (via `form-version-compiler`) and surfaced on
 * `FieldDescriptor.validations` so the studio preview, the public runner,
 * and the submission service share one source of truth (MUST 15).
 *
 * Determinism guarantees:
 * - Pure functions — no I/O, no DI, no module-scoped state besides a regex
 *   cache keyed on the source string.
 * - `null` / `undefined` short-circuit every rule as `{ valid: true }`. The
 *   existing JSON-Schema `required` keyword is the only authority on
 *   required-ness; this service only enforces declared shape rules.
 * - The `pattern` rule is wrapped in a wall-clock guard (R-1 mitigation —
 *   catastrophic regex). Patterns that take more than 50ms to evaluate are
 *   reported as failures so the studio surfaces them as an inline alert.
 */

import { OM_FIELD_KEYWORDS } from '../schema/jsonschema-extensions'
import { FIELD_TYPE_DEFAULT_PATTERNS } from '../schema/field-type-patterns'
import type { FieldNode } from '../backend/forms/[id]/studio/schema-helpers'

// ============================================================================
// Public types
// ============================================================================

export type ValidationRule =
  | { type: 'pattern'; pattern: string; message?: string }
  | { type: 'minLength'; value: number; message?: string }
  | { type: 'maxLength'; value: number; message?: string }
  | { type: 'minValue'; value: number; message?: string }
  | { type: 'maxValue'; value: number; message?: string }
  | { type: 'format'; format: 'email' | 'phone' | 'website'; message?: string }
  | { type: 'rankingExhaustive'; optionCount: number; message?: string }
  | { type: 'matrixRowsRequired'; rowKeys: string[]; message?: string }

export type ValidationRuleType = ValidationRule['type']

export type ValidationRules = ReadonlyArray<ValidationRule>

export type ValidationResult =
  | { valid: true }
  | { valid: false; rule: ValidationRuleType; message: string }

export type ValidationMessageOverrides = Record<string, Record<string, string>>

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_MESSAGES: Record<ValidationRuleType, (rule: ValidationRule) => string> = {
  pattern: () => 'Value does not match the expected format.',
  minLength: (rule) =>
    rule.type === 'minLength'
      ? `Please enter at least ${rule.value} characters.`
      : 'Value is too short.',
  maxLength: (rule) =>
    rule.type === 'maxLength'
      ? `Please enter at most ${rule.value} characters.`
      : 'Value is too long.',
  minValue: (rule) =>
    rule.type === 'minValue' ? `Please enter at least ${rule.value}.` : 'Value is too low.',
  maxValue: (rule) =>
    rule.type === 'maxValue' ? `Please enter at most ${rule.value}.` : 'Value is too high.',
  format: (rule) => {
    if (rule.type !== 'format') return 'Value does not match the expected format.'
    if (rule.format === 'email') return 'Please enter a valid email address.'
    if (rule.format === 'phone') return 'Please enter a valid phone number.'
    return 'Please enter a valid URL.'
  },
  rankingExhaustive: () => 'Please rank every option.',
  matrixRowsRequired: () => 'Please answer every required row.',
}

const REGEX_TIMEOUT_MS = 50

const REGEX_CACHE: Map<string, RegExp> = new Map()

function compileRegex(source: string): RegExp | null {
  const cached = REGEX_CACHE.get(source)
  if (cached) return cached
  try {
    const compiled = new RegExp(source)
    REGEX_CACHE.set(source, compiled)
    return compiled
  } catch {
    return null
  }
}

// ============================================================================
// Compile rules from a field node
// ============================================================================

/**
 * Reads validation keywords off the persisted field node and returns the
 * compiled rule list. Phase A wires `x-om-pattern`, `x-om-min-length`,
 * `x-om-max-length`, `x-om-min`, and `x-om-max`. Phases B / E / F will add
 * `format`, `rankingExhaustive`, and `matrixRowsRequired` entries.
 *
 * `fieldType` is accepted now so the future phases can dispatch on it
 * without changing the signature.
 */
export function compileFieldValidationRules(
  fieldNode: FieldNode,
  fieldType: string,
): ValidationRules {
  const node = fieldNode as Record<string, unknown>
  const rules: ValidationRule[] = []

  const pattern = node[OM_FIELD_KEYWORDS.pattern]
  if (typeof pattern === 'string' && pattern.length > 0) {
    rules.push({ type: 'pattern', pattern })
  }
  const minLength = node[OM_FIELD_KEYWORDS.minLength]
  if (typeof minLength === 'number' && Number.isInteger(minLength) && minLength >= 0) {
    rules.push({ type: 'minLength', value: minLength })
  }
  const maxLength = node[OM_FIELD_KEYWORDS.maxLength]
  if (typeof maxLength === 'number' && Number.isInteger(maxLength) && maxLength >= 0) {
    rules.push({ type: 'maxLength', value: maxLength })
  }
  const min = node[OM_FIELD_KEYWORDS.min]
  if (typeof min === 'number' && Number.isFinite(min)) {
    rules.push({ type: 'minValue', value: min })
  }
  const max = node[OM_FIELD_KEYWORDS.max]
  if (typeof max === 'number' && Number.isFinite(max)) {
    rules.push({ type: 'maxValue', value: max })
  }

  // Tier-2 Phase B — emit a `format` rule for the three registered format
  // types. The format rule resolves to the active pattern at validation time
  // (overridden by `x-om-pattern` when present, otherwise the seeded default
  // from `FIELD_TYPE_DEFAULT_PATTERNS`). The seeded default is never written
  // back to the persisted schema (R-9 / MUST 12 — verbatim round-trip).
  if (fieldType === 'email' || fieldType === 'phone' || fieldType === 'website') {
    rules.push({ type: 'format', format: fieldType })
  }

  // Tier-2 Phase D — NPS has fixed 0..10 bounds even when `x-om-min/max` are
  // absent; opinion_scale defaults to 1..5. We only emit these rules when the
  // generic `x-om-min/x-om-max` did not already produce them (above) so we
  // don't double-emit a `minValue` rule for opinion_scale with explicit bounds.
  const emittedMin = rules.some((rule) => rule.type === 'minValue')
  const emittedMax = rules.some((rule) => rule.type === 'maxValue')
  if (fieldType === 'nps') {
    if (!emittedMin) rules.push({ type: 'minValue', value: 0 })
    if (!emittedMax) rules.push({ type: 'maxValue', value: 10 })
  } else if (fieldType === 'opinion_scale') {
    if (!emittedMin) rules.push({ type: 'minValue', value: 1 })
    if (!emittedMax) rules.push({ type: 'maxValue', value: 5 })
  }

  // Tier-2 Phase E — emit an exhaustive-ranking rule when the author opted in
  // (Decision 4). The optionCount is captured at compile time so the runner
  // can check `value.length === optionCount` without re-reading the schema.
  if (fieldType === 'ranking' && node[OM_FIELD_KEYWORDS.rankingExhaustive] === true) {
    const options = node['x-om-options']
    const optionCount = Array.isArray(options) ? options.length : 0
    rules.push({ type: 'rankingExhaustive', optionCount })
  }

  // Tier-2 Phase F — emit `matrixRowsRequired` when any matrix row opts into
  // `required: true`. The runner enforces presence per row at submit time.
  if (fieldType === 'matrix') {
    const matrixRows = node[OM_FIELD_KEYWORDS.matrixRows]
    if (Array.isArray(matrixRows)) {
      const requiredKeys: string[] = []
      for (const entry of matrixRows) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const candidate = entry as Record<string, unknown>
        if (typeof candidate.key === 'string' && candidate.required === true) {
          requiredKeys.push(candidate.key)
        }
      }
      if (requiredKeys.length > 0) {
        rules.push({ type: 'matrixRowsRequired', rowKeys: requiredKeys })
      }
    }
  }

  return rules
}

/**
 * Resolves the active pattern source for a `format` rule. The compiled rule
 * carries the `format` discriminant; the persisted `x-om-pattern` (if any) is
 * read off the field node at validation time so per-field overrides apply
 * without writing them onto the rule.
 */
export function resolveFormatPatternSource(
  format: 'email' | 'phone' | 'website',
  fieldNode?: FieldNode,
): string {
  if (fieldNode) {
    const override = (fieldNode as Record<string, unknown>)[OM_FIELD_KEYWORDS.pattern]
    if (typeof override === 'string' && override.length > 0) return override
  }
  return FIELD_TYPE_DEFAULT_PATTERNS[format]
}

// ============================================================================
// Validate a value against a compiled rule set
// ============================================================================

export function validateFieldValue(
  value: unknown,
  rules: ValidationRules,
  locale: string,
  messages?: ValidationMessageOverrides,
  fieldNode?: FieldNode,
): ValidationResult {
  if (value === null || value === undefined) return { valid: true }
  for (const rule of rules) {
    const result = applyRule(value, rule, locale, messages, fieldNode)
    if (!result.valid) return result
  }
  return { valid: true }
}

function applyRule(
  value: unknown,
  rule: ValidationRule,
  locale: string,
  messages: ValidationMessageOverrides | undefined,
  fieldNode: FieldNode | undefined,
): ValidationResult {
  switch (rule.type) {
    case 'pattern': {
      if (typeof value !== 'string') return { valid: true }
      const regex = compileRegex(rule.pattern)
      if (!regex) {
        return failed(rule, locale, messages, 'Invalid regular expression.')
      }
      const started = Date.now()
      let matched = false
      try {
        matched = regex.test(value)
      } catch {
        return failed(rule, locale, messages)
      }
      const elapsed = Date.now() - started
      if (elapsed > REGEX_TIMEOUT_MS) {
        return failed(rule, locale, messages, 'Regular expression took too long to evaluate.')
      }
      return matched ? { valid: true } : failed(rule, locale, messages)
    }
    case 'minLength': {
      if (typeof value !== 'string') return { valid: true }
      return value.length >= rule.value ? { valid: true } : failed(rule, locale, messages)
    }
    case 'maxLength': {
      if (typeof value !== 'string') return { valid: true }
      return value.length <= rule.value ? { valid: true } : failed(rule, locale, messages)
    }
    case 'minValue': {
      if (typeof value !== 'number') return { valid: true }
      return value >= rule.value ? { valid: true } : failed(rule, locale, messages)
    }
    case 'maxValue': {
      if (typeof value !== 'number') return { valid: true }
      return value <= rule.value ? { valid: true } : failed(rule, locale, messages)
    }
    case 'format': {
      if (typeof value !== 'string') return { valid: true }
      if (value.length === 0) return { valid: true }
      const source = resolveFormatPatternSource(rule.format, fieldNode)
      const regex = compileRegex(source)
      if (!regex) return failed(rule, locale, messages, 'Invalid regular expression.')
      const started = Date.now()
      let matched = false
      try {
        matched = regex.test(value)
      } catch {
        return failed(rule, locale, messages)
      }
      const elapsed = Date.now() - started
      if (elapsed > REGEX_TIMEOUT_MS) {
        return failed(rule, locale, messages, 'Regular expression took too long to evaluate.')
      }
      return matched ? { valid: true } : failed(rule, locale, messages)
    }
    case 'rankingExhaustive': {
      // Phase E — exhaustive ranking. `value` must be an array of length
      // exactly `optionCount`; the per-entry validation (string, no dupes,
      // value ∈ x-om-options) is enforced by the field-type registry's
      // `validator` hook, so this rule only needs to count.
      if (!Array.isArray(value)) return failed(rule, locale, messages)
      return value.length === rule.optionCount
        ? { valid: true }
        : failed(rule, locale, messages)
    }
    case 'matrixRowsRequired': {
      // Phase F — every row key listed must have a non-empty value present in
      // the persisted matrix object.
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return failed(rule, locale, messages)
      }
      const record = value as Record<string, unknown>
      for (const rowKey of rule.rowKeys) {
        const entry = record[rowKey]
        if (entry === undefined || entry === null) return failed(rule, locale, messages)
        if (Array.isArray(entry)) {
          if (entry.length === 0) return failed(rule, locale, messages)
        } else if (typeof entry === 'string') {
          if (entry.length === 0) return failed(rule, locale, messages)
        } else {
          return failed(rule, locale, messages)
        }
      }
      return { valid: true }
    }
  }
}

function failed(
  rule: ValidationRule,
  locale: string,
  messages: ValidationMessageOverrides | undefined,
  override?: string,
): ValidationResult {
  if (override) return { valid: false, rule: rule.type, message: override }
  const fromLocale = messages?.[locale]?.[rule.type]
  if (fromLocale) return { valid: false, rule: rule.type, message: fromLocale }
  const fromEnglish = messages?.en?.[rule.type]
  if (fromEnglish) return { valid: false, rule: rule.type, message: fromEnglish }
  if (rule.message) return { valid: false, rule: rule.type, message: rule.message }
  const fallback = DEFAULT_MESSAGES[rule.type](rule)
  return { valid: false, rule: rule.type, message: fallback }
}

/**
 * Test-only helper — clears the module-level regex cache between tests.
 */
export function __resetFieldValidationServiceCacheForTests(): void {
  REGEX_CACHE.clear()
}
