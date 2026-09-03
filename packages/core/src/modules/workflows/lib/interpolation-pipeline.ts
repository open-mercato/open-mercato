/**
 * Workflows Module - interpolation pipeline grammar (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.6, Phase 2b).
 *
 * Pure, dependency-free parser and evaluator for the pill transform pipeline
 * inside `{{ }}` interpolation tokens: `path | fn(args) | fn2(...)`. No React,
 * no ORM, no DI container, no registry imports — the module must stay loadable
 * from the browser bundle and from the runtime engine alike
 * (`interpolation-pipeline-import-boundary.test.ts` guards this).
 *
 * Grammar:
 * - The token text between `{{` and `}}` splits on top-level `|` characters
 *   (pipes inside quoted strings or parentheses are literal). The first
 *   segment is the lookup path (trimmed, exactly as the legacy interpolator
 *   treats it); every following segment is one transform call.
 * - A transform call is `name` or `name(arg, arg2, ...)` where `name` matches
 *   `[A-Za-z_][A-Za-z0-9_]*` and each argument is a JSON-ish literal: a
 *   single- or double-quoted string (backslash escapes), a number, `true`,
 *   `false`, or `null`. No arbitrary expressions, no eval.
 * - A pipe-free token parses to `{ path, transforms: [] }`, keeping legacy
 *   tokens byte-identical in behavior.
 *
 * The transform table is fixed and every entry is a pure function; evaluation
 * either succeeds with a value or fails with a typed error (`unknown-transform`,
 * `invalid-args`, `invalid-input`) that the caller maps to lenient
 * pass-through or strict failure.
 */

export type WorkflowInterpolationMode = 'strict' | 'lenient'

export function resolveDefinitionInterpolationMode(
  definitionData: unknown,
): WorkflowInterpolationMode | undefined {
  if (!definitionData || typeof definitionData !== 'object') return undefined
  const mode = (definitionData as { interpolation?: unknown }).interpolation
  return mode === 'strict' || mode === 'lenient' ? mode : undefined
}

export type TransformArg = string | number | boolean | null

export interface ParsedTransform {
  name: string
  args: TransformArg[]
}

export interface ParsedInterpolationToken {
  path: string
  transforms: ParsedTransform[]
}

export type InterpolationTokenParseResult =
  | { ok: true; path: string; transforms: ParsedTransform[] }
  | { ok: false; error: string }

export type TransformErrorCode = 'unknown-transform' | 'invalid-args' | 'invalid-input'

export interface TransformError {
  code: TransformErrorCode
  transform: string
  message: string
}

export type TransformApplyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: TransformError }

const TRANSFORM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function splitTopLevel(input: string, separator: string): string[] | null {
  const segments: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quote !== null) {
      current += char
      if (char === '\\' && index + 1 < input.length) {
        current += input[index + 1]
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth < 0) return null
    }
    if (char === separator && depth === 0) {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (quote !== null || depth !== 0) return null
  segments.push(current)
  return segments
}

function parseLiteralArg(raw: string): { ok: true; value: TransformArg } | { ok: false } {
  if (!raw) return { ok: false }
  const first = raw[0]
  if ((first === "'" || first === '"') && raw.length >= 2 && raw.endsWith(first)) {
    const body = raw.slice(1, -1)
    let value = ''
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index]
      if (char === '\\' && index + 1 < body.length) {
        value += body[index + 1]
        index += 1
        continue
      }
      if (char === first) return { ok: false }
      value += char
    }
    return { ok: true, value }
  }
  if (raw === 'true') return { ok: true, value: true }
  if (raw === 'false') return { ok: true, value: false }
  if (raw === 'null') return { ok: true, value: null }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { ok: true, value: Number(raw) }
  return { ok: false }
}

function parseTransformSegment(
  segment: string,
): { ok: true; transform: ParsedTransform } | { ok: false; error: string } {
  const trimmed = segment.trim()
  if (!trimmed) return { ok: false, error: 'empty transform segment' }
  const parenIndex = trimmed.indexOf('(')
  if (parenIndex === -1) {
    if (!TRANSFORM_NAME_PATTERN.test(trimmed)) {
      return { ok: false, error: `invalid transform name "${trimmed}"` }
    }
    return { ok: true, transform: { name: trimmed, args: [] } }
  }
  const name = trimmed.slice(0, parenIndex).trim()
  if (!TRANSFORM_NAME_PATTERN.test(name)) {
    return { ok: false, error: `invalid transform name "${name}"` }
  }
  if (!trimmed.endsWith(')')) {
    return { ok: false, error: `unterminated arguments for transform "${name}"` }
  }
  const argsSource = trimmed.slice(parenIndex + 1, -1).trim()
  if (!argsSource) return { ok: true, transform: { name, args: [] } }
  const rawArgs = splitTopLevel(argsSource, ',')
  if (rawArgs === null) {
    return { ok: false, error: `unbalanced arguments for transform "${name}"` }
  }
  const args: TransformArg[] = []
  for (const rawArg of rawArgs) {
    const trimmedArg = rawArg.trim()
    const parsedArg = parseLiteralArg(trimmedArg)
    if (!parsedArg.ok) {
      return { ok: false, error: `invalid argument "${trimmedArg}" for transform "${name}"` }
    }
    args.push(parsedArg.value)
  }
  return { ok: true, transform: { name, args } }
}

export function parseInterpolationToken(token: string): InterpolationTokenParseResult {
  const segments = splitTopLevel(token, '|')
  if (segments === null) {
    return { ok: false, error: 'unbalanced quotes or parentheses in interpolation token' }
  }
  const path = segments[0].trim()
  if (!path) return { ok: false, error: 'empty interpolation path' }
  const transforms: ParsedTransform[] = []
  for (const segment of segments.slice(1)) {
    const parsed = parseTransformSegment(segment)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    transforms.push(parsed.transform)
  }
  return { ok: true, path, transforms }
}

function invalidArgs(transform: string, message: string): TransformApplyResult {
  return { ok: false, error: { code: 'invalid-args', transform, message } }
}

function invalidInput(transform: string, message: string): TransformApplyResult {
  return { ok: false, error: { code: 'invalid-input', transform, message } }
}

function coerceText(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function padDatePart(part: number, length: number): string {
  return String(part).padStart(length, '0')
}

function formatDate(date: Date, format: string): string {
  return format.replace(/yyyy|SSS|MM|dd|HH|mm|ss/g, (token) => {
    switch (token) {
      case 'yyyy':
        return padDatePart(date.getUTCFullYear(), 4)
      case 'MM':
        return padDatePart(date.getUTCMonth() + 1, 2)
      case 'dd':
        return padDatePart(date.getUTCDate(), 2)
      case 'HH':
        return padDatePart(date.getUTCHours(), 2)
      case 'mm':
        return padDatePart(date.getUTCMinutes(), 2)
      case 'ss':
        return padDatePart(date.getUTCSeconds(), 2)
      case 'SSS':
        return padDatePart(date.getUTCMilliseconds(), 3)
      default:
        return token
    }
  })
}

type TransformImpl = (value: unknown, args: TransformArg[]) => TransformApplyResult

function textTransform(name: string, apply: (text: string) => string): TransformImpl {
  return (value, args) => {
    if (args.length !== 0) return invalidArgs(name, 'expects no arguments')
    const text = coerceText(value)
    if (text === null) return invalidInput(name, 'value is not text')
    return { ok: true, value: apply(text) }
  }
}

function affixTransform(name: string, combine: (text: string, affix: string) => string): TransformImpl {
  return (value, args) => {
    if (args.length !== 1) return invalidArgs(name, 'expects exactly one argument')
    const affix = coerceText(args[0])
    if (affix === null) return invalidArgs(name, 'argument must be text')
    const text = coerceText(value)
    if (text === null) return invalidInput(name, 'value is not text')
    return { ok: true, value: combine(text, affix) }
  }
}

const transformTable: Record<string, TransformImpl> = {
  date: (value, args) => {
    if (args.length > 1 || (args.length === 1 && typeof args[0] !== 'string')) {
      return invalidArgs('date', 'expects an optional format string')
    }
    const date = toDateValue(value)
    if (date === null) return invalidInput('date', 'value is not a date')
    if (args.length === 0) return { ok: true, value: date.toISOString() }
    return { ok: true, value: formatDate(date, args[0] as string) }
  },
  number: (value, args) => {
    if (args.length > 2) return invalidArgs('number', 'expects at most decimals and locale')
    const decimals = args[0]
    if (
      args.length >= 1 &&
      (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 20)
    ) {
      return invalidArgs('number', 'decimals must be an integer between 0 and 20')
    }
    const locale = args[1]
    if (args.length === 2 && typeof locale !== 'string') {
      return invalidArgs('number', 'locale must be a string')
    }
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN
    if (!Number.isFinite(numeric)) return invalidInput('number', 'value is not a finite number')
    if (args.length === 0) return { ok: true, value: String(numeric) }
    if (args.length === 1) return { ok: true, value: numeric.toFixed(decimals as number) }
    try {
      const formatter = new Intl.NumberFormat(locale as string, {
        minimumFractionDigits: decimals as number,
        maximumFractionDigits: decimals as number,
      })
      return { ok: true, value: formatter.format(numeric) }
    } catch {
      return invalidArgs('number', `unknown locale "${String(locale)}"`)
    }
  },
  upper: textTransform('upper', (text) => text.toUpperCase()),
  lower: textTransform('lower', (text) => text.toLowerCase()),
  title: textTransform('title', (text) =>
    text.toLowerCase().replace(/(^|\s)(\S)/g, (_match, boundary: string, letter: string) => `${boundary}${letter.toUpperCase()}`),
  ),
  concat: affixTransform('concat', (text, suffix) => `${text}${suffix}`),
  prepend: affixTransform('prepend', (text, prefix) => `${prefix}${text}`),
  default: (value, args) => {
    if (args.length !== 1) return invalidArgs('default', 'expects exactly one value')
    const isEmpty = value === undefined || value === null || value === ''
    return { ok: true, value: isEmpty ? args[0] : value }
  },
  pick: (value, args) => {
    if (args.length !== 1 || (typeof args[0] !== 'string' && typeof args[0] !== 'number')) {
      return invalidArgs('pick', 'expects a field name or index')
    }
    const key = args[0]
    if (Array.isArray(value)) {
      const index = typeof key === 'number' ? key : Number(key)
      return { ok: true, value: Number.isInteger(index) ? value[index] : undefined }
    }
    if (value !== null && typeof value === 'object') {
      return { ok: true, value: (value as Record<string, unknown>)[String(key)] }
    }
    return invalidInput('pick', 'value is not an object or array')
  },
}

export const interpolationTransformNames: readonly string[] = Object.freeze(
  Object.keys(transformTable),
)

export function applyTransforms(value: unknown, transforms: ParsedTransform[]): TransformApplyResult {
  let current: unknown = value
  for (const transform of transforms) {
    const impl = transformTable[transform.name]
    if (!impl) {
      return {
        ok: false,
        error: {
          code: 'unknown-transform',
          transform: transform.name,
          message: `unknown transform "${transform.name}"`,
        },
      }
    }
    const result = impl(current, transform.args)
    if (!result.ok) return result
    current = result.value
  }
  return { ok: true, value: current }
}
