import { parseDocument, stringify } from 'yaml'
import {
  EVAL_SET_FILE_ISSUE,
  EvalSetFileInvalidError,
  validateEvalSetFile,
  type EvalSetFile,
  type EvalSetFileIssue,
  type EvalSetFileValidation,
} from './evalSetFile'
import { resolveEvalSetMaxBytes } from './manifest'

export type EvalSetTextFormat = 'json' | 'yaml'

export const EVAL_SET_YAML_MAX_ALIAS_COUNT = 0

const FILE_KEY_ORDER = ['format', 'formatVersion', 'agentId', 'label', 'assertions', 'cases'] as const
const ASSERTION_KEY_ORDER = ['key', 'scorerKey', 'type', 'severity', 'title', 'config'] as const
const CASE_KEY_ORDER = ['key', 'name', 'input', 'expected', 'assertions', 'fixtures'] as const
const CASE_REF_KEY_ORDER = ['key', 'configOverride', 'disabled'] as const
const FIXTURE_KEY_ORDER = ['tools', 'model'] as const

type TextOptions = { maxBytes?: number; format?: EvalSetTextFormat | 'auto' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sortedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedDeep)
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (value[key] !== undefined) result[key] = sortedDeep(value[key])
  }
  return result
}

function ordered(
  value: Record<string, unknown>,
  order: ReadonlyArray<string>,
  freeForm: ReadonlySet<string>,
  nested: Record<string, (entry: unknown) => unknown> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of order) {
    if (value[key] === undefined) continue
    if (nested[key]) result[key] = nested[key](value[key])
    else result[key] = freeForm.has(key) ? sortedDeep(value[key]) : value[key]
  }
  return result
}

function mapEach(mapper: (entry: Record<string, unknown>) => Record<string, unknown>) {
  return (entry: unknown): unknown =>
    Array.isArray(entry) ? entry.map((item) => (isPlainObject(item) ? mapper(item) : item)) : entry
}

function orderedAssertion(entry: Record<string, unknown>): Record<string, unknown> {
  return ordered(entry, ASSERTION_KEY_ORDER, new Set(['config']))
}

function orderedCaseRef(entry: Record<string, unknown>): Record<string, unknown> {
  return ordered(entry, CASE_REF_KEY_ORDER, new Set(['configOverride']))
}

function orderedCase(entry: Record<string, unknown>): Record<string, unknown> {
  return ordered(entry, CASE_KEY_ORDER, new Set(['input', 'expected']), {
    assertions: mapEach(orderedCaseRef),
    fixtures: (fixtures) => (isPlainObject(fixtures) ? ordered(fixtures, FIXTURE_KEY_ORDER, new Set()) : fixtures),
  })
}

export function orderEvalSetFileForSerialization(file: EvalSetFile): Record<string, unknown> {
  return ordered(file as unknown as Record<string, unknown>, FILE_KEY_ORDER, new Set(), {
    assertions: mapEach(orderedAssertion),
    cases: mapEach(orderedCase),
  })
}

export function stringifyEvalSetFile(file: EvalSetFile, format: EvalSetTextFormat = 'yaml'): string {
  const value = orderEvalSetFileForSerialization(file)
  if (format === 'json') return `${JSON.stringify(value, null, 2)}\n`
  return stringify(value, {
    version: '1.2',
    schema: 'core',
    aliasDuplicateObjects: false,
    indent: 2,
    lineWidth: 0,
    sortMapEntries: false,
  })
}

export function detectEvalSetTextFormat(text: string): EvalSetTextFormat {
  const first = text.replace(/^﻿/, '').trimStart()[0]
  return first === '{' || first === '[' ? 'json' : 'yaml'
}

function invalid(message: string, code: EvalSetFileIssue['code'] = EVAL_SET_FILE_ISSUE.invalidFormat, path = ''): EvalSetFileValidation {
  return { ok: false, issues: [{ code, path, message }] }
}

type ParsedText = { ok: true; value: unknown } | { ok: false; issues: EvalSetFileIssue[] }

function classifyYamlError(name: string, message: string): EvalSetFileIssue['code'] {
  return name === 'YAMLParseError' && /duplicate|unique/i.test(message)
    ? EVAL_SET_FILE_ISSUE.duplicateKey
    : EVAL_SET_FILE_ISSUE.invalidFormat
}

function parseYamlText(text: string): ParsedText {
  const source = text.replace(/^﻿/, '')
  const doc = parseDocument(source, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
    strict: true,
    keepSourceTokens: false,
  })
  const problems = [...doc.errors, ...doc.warnings]
  if (problems.length > 0) {
    return {
      ok: false,
      issues: problems.slice(0, 5).map((problem) => ({
        code: classifyYamlError(problem.name, problem.message),
        path: '',
        message: `yaml: ${problem.message.split('\n')[0]}`,
      })),
    }
  }
  try {
    return { ok: true, value: doc.toJS({ maxAliasCount: EVAL_SET_YAML_MAX_ALIAS_COUNT, mapAsMap: false }) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreadable yaml'
    return { ok: false, issues: [{ code: EVAL_SET_FILE_ISSUE.invalidFormat, path: '', message: `yaml: ${message.split('\n')[0]}` }] }
  }
}

function parseJsonText(text: string): ParsedText {
  const source = text.replace(/^﻿/, '')
  try {
    JSON.parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unreadable json'
    return { ok: false, issues: [{ code: EVAL_SET_FILE_ISSUE.invalidFormat, path: '', message: `json: ${message}` }] }
  }
  return parseYamlText(source)
}

export function validateEvalSetText(text: string, options: TextOptions = {}): EvalSetFileValidation {
  if (typeof text !== 'string') return invalid('eval set text must be a string')
  const maxBytes = options.maxBytes ?? resolveEvalSetMaxBytes()
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) {
    return invalid(
      `eval set text is ${bytes} bytes, above the ${maxBytes}-byte limit (OM_AGENT_EVAL_SET_MAX_BYTES)`,
      EVAL_SET_FILE_ISSUE.tooLarge,
    )
  }
  const requested = options.format ?? 'auto'
  const format = requested === 'auto' ? detectEvalSetTextFormat(text) : requested
  const parsed = format === 'json' ? parseJsonText(text) : parseYamlText(text)
  if (!parsed.ok) return { ok: false, issues: parsed.issues }
  return validateEvalSetFile(parsed.value, { maxBytes })
}

export function parseEvalSetText(text: string, options: TextOptions = {}): EvalSetFile {
  const result = validateEvalSetText(text, options)
  if (!result.ok) throw new EvalSetFileInvalidError(result.issues)
  return result.file
}
