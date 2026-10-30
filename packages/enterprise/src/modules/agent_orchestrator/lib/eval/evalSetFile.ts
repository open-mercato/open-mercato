import { z } from 'zod'
import { canonicalJson } from './canonicalInputKey'
import {
  EVAL_SET_FORMAT,
  EVAL_SET_FORMAT_VERSION,
  assertManifestWithinCap,
  deterministicAssertionId,
  deterministicCaseId,
  hashManifest,
  normalizeManifest,
  resolveEvalSetMaxBytes,
  type EvalSetManifest,
  type EvalSetManifestAssertion,
  type EvalSetManifestCase,
  frozenJudgeRubric,
} from './manifest'
import { getScorerDefinition, parseScorerConfig } from './registry'
import { collectRubricRefs, readRubricRef, resolveRubricRef } from './rubrics'
import type { Json } from './types'

export const SUPPORTED_EVAL_SET_FORMAT_VERSIONS: ReadonlyArray<number> = [EVAL_SET_FORMAT_VERSION]
export const EVAL_SET_FILE_MAX_CASES = 5000
export const EVAL_SET_FILE_MAX_ASSERTIONS = 500
export const EVAL_SET_FILE_MAX_CASE_ASSERTION_REFS = 100
export const EVAL_SET_FILE_MAX_FIXTURE_PATH_LENGTH = 500

export const EVAL_SET_FILE_ISSUE = {
  invalidFormat: 'invalid_format',
  unsupportedFormatVersion: 'unsupported_format_version',
  schema: 'schema',
  tooLarge: 'eval_set_too_large',
  duplicateKey: 'duplicate_key',
  unknownScorer: 'unknown_scorer',
  scorerTypeMismatch: 'scorer_type_mismatch',
  invalidScorerConfig: 'invalid_scorer_config',
  unknownRubric: 'unknown_rubric',
  judgeGate: 'judge_gate_refused',
  unknownAssertionRef: 'unknown_assertion_ref',
  duplicateAssertionRef: 'duplicate_assertion_ref',
} as const

export type EvalSetFileIssueCode = (typeof EVAL_SET_FILE_ISSUE)[keyof typeof EVAL_SET_FILE_ISSUE]

export type EvalSetFileIssue = { code: EvalSetFileIssueCode; path: string; message: string }

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
)

const jsonObjectSchema = z.record(z.string(), jsonSchema)

const fixturePathSchema = z
  .string()
  .min(1)
  .max(EVAL_SET_FILE_MAX_FIXTURE_PATH_LENGTH)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes('\0') &&
      !value.split(/[\\/]/).includes('..'),
    'fixture paths must be relative to the eval set file and must not leave its directory',
  )

export const evalSetFileAssertionSchema = z
  .object({
    key: z.string().min(1).max(100),
    scorerKey: z.string().min(1).max(100),
    type: z.enum(['deterministic', 'llm_judge']).optional(),
    severity: z.enum(['gate', 'warn']),
    title: z.string().min(1).max(200),
    config: jsonObjectSchema.optional(),
  })
  .strict()

export const evalSetFileCaseAssertionRefSchema = z
  .object({
    key: z.string().min(1).max(100),
    configOverride: jsonObjectSchema.nullable().optional(),
    disabled: z.boolean().optional(),
  })
  .strict()

export const evalSetFileCaseSchema = z
  .object({
    key: z.string().min(1).max(200),
    name: z.string().max(500).nullable().optional(),
    input: jsonSchema,
    expected: jsonSchema.nullable().optional(),
    assertions: z.array(evalSetFileCaseAssertionRefSchema).max(EVAL_SET_FILE_MAX_CASE_ASSERTION_REFS).nullable().optional(),
    fixtures: z
      .object({ tools: fixturePathSchema.optional(), model: fixturePathSchema.optional() })
      .strict()
      .optional(),
  })
  .strict()

export const evalSetFileSchema = z
  .object({
    format: z.literal(EVAL_SET_FORMAT),
    formatVersion: z.literal(EVAL_SET_FORMAT_VERSION),
    agentId: z.string().min(1).max(100),
    label: z.string().min(1).max(100).nullable().optional(),
    assertions: z.array(evalSetFileAssertionSchema).max(EVAL_SET_FILE_MAX_ASSERTIONS).default([]),
    cases: z.array(evalSetFileCaseSchema).max(EVAL_SET_FILE_MAX_CASES),
  })
  .strict()

export type EvalSetFile = z.infer<typeof evalSetFileSchema>
export type EvalSetFileAssertion = z.infer<typeof evalSetFileAssertionSchema>
export type EvalSetFileCase = z.infer<typeof evalSetFileCaseSchema>
export type EvalSetFileCaseAssertionRef = z.infer<typeof evalSetFileCaseAssertionRefSchema>

export type EvalSetFileValidation =
  | { ok: true; file: EvalSetFile }
  | { ok: false; issues: EvalSetFileIssue[] }

export class EvalSetFileInvalidError extends Error {
  readonly code = 'eval_set_file_invalid'

  constructor(readonly issues: EvalSetFileIssue[]) {
    super(
      `[internal] eval set file is invalid: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.path || '.'} ${issue.message}`)
        .join('; ')}`,
    )
    this.name = 'EvalSetFileInvalidError'
  }
}

function formatPath(path: ReadonlyArray<string | number>): string {
  return path.map((segment) => String(segment)).join('.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function envelopeIssues(raw: unknown): EvalSetFileIssue[] {
  if (!isRecord(raw)) {
    return [{ code: EVAL_SET_FILE_ISSUE.invalidFormat, path: '', message: 'eval set file must be an object' }]
  }
  if (raw.format !== EVAL_SET_FORMAT) {
    return [
      {
        code: EVAL_SET_FILE_ISSUE.invalidFormat,
        path: 'format',
        message: `format must be "${EVAL_SET_FORMAT}"`,
      },
    ]
  }
  if (typeof raw.formatVersion !== 'number' || !SUPPORTED_EVAL_SET_FORMAT_VERSIONS.includes(raw.formatVersion)) {
    return [
      {
        code: EVAL_SET_FILE_ISSUE.unsupportedFormatVersion,
        path: 'formatVersion',
        message: `formatVersion ${JSON.stringify(raw.formatVersion ?? null)} is not supported (supported: ${SUPPORTED_EVAL_SET_FORMAT_VERSIONS.join(', ')})`,
      },
    ]
  }
  return []
}

function duplicateKeyIssues(keys: ReadonlyArray<string>, pathPrefix: string, label: string): EvalSetFileIssue[] {
  const seen = new Set<string>()
  const issues: EvalSetFileIssue[] = []
  keys.forEach((key, index) => {
    if (seen.has(key)) {
      issues.push({
        code: EVAL_SET_FILE_ISSUE.duplicateKey,
        path: `${pathPrefix}.${index}.key`,
        message: `duplicate ${label} key "${key}"`,
      })
    }
    seen.add(key)
  })
  return issues
}

function assertionIssues(agentId: string, assertion: EvalSetFileAssertion, index: number): EvalSetFileIssue[] {
  const path = `assertions.${index}`
  const definition = getScorerDefinition(assertion.scorerKey)
  if (!definition) {
    return [
      {
        code: EVAL_SET_FILE_ISSUE.unknownScorer,
        path: `${path}.scorerKey`,
        message: `unknown scorer "${assertion.scorerKey}"`,
      },
    ]
  }
  const issues: EvalSetFileIssue[] = []
  if (assertion.type && assertion.type !== definition.kind) {
    issues.push({
      code: EVAL_SET_FILE_ISSUE.scorerTypeMismatch,
      path: `${path}.type`,
      message: `scorer "${assertion.scorerKey}" is ${definition.kind}, not ${assertion.type}`,
    })
  }
  if (definition.kind === 'llm_judge' && assertion.severity === 'gate') {
    issues.push({
      code: EVAL_SET_FILE_ISSUE.judgeGate,
      path: `${path}.severity`,
      message: 'llm_judge assertions must use severity "warn"',
    })
  }
  const parsed = parseScorerConfig(assertion.scorerKey, assertion.config ?? {}, 'write')
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      issues.push({ code: EVAL_SET_FILE_ISSUE.invalidScorerConfig, path: `${path}.config`, message: issue })
    }
    return issues
  }
  const rubricRef = definition.kind === 'llm_judge' ? readRubricRef(assertion.config) : null
  if (rubricRef && !resolveRubricRef(agentId, rubricRef)) {
    issues.push({
      code: EVAL_SET_FILE_ISSUE.unknownRubric,
      path: `${path}.config.rubricRef`,
      message: `rubric "${rubricRef}" is neither declared by agent "${agentId}" nor built in`,
    })
  }
  return issues
}

function caseRefIssues(
  entry: EvalSetFileCase,
  caseIndex: number,
  assertionsByKey: ReadonlyMap<string, EvalSetFileAssertion>,
): EvalSetFileIssue[] {
  const issues: EvalSetFileIssue[] = []
  const seen = new Set<string>()
  ;(entry.assertions ?? []).forEach((ref, refIndex) => {
    const path = `cases.${caseIndex}.assertions.${refIndex}`
    if (seen.has(ref.key)) {
      issues.push({
        code: EVAL_SET_FILE_ISSUE.duplicateAssertionRef,
        path: `${path}.key`,
        message: `assertion "${ref.key}" is referenced more than once`,
      })
      return
    }
    seen.add(ref.key)
    const assertion = assertionsByKey.get(ref.key)
    if (!assertion) {
      issues.push({
        code: EVAL_SET_FILE_ISSUE.unknownAssertionRef,
        path: `${path}.key`,
        message: `assertion "${ref.key}" is not declared in this eval set`,
      })
      return
    }
    if (!ref.configOverride || !getScorerDefinition(assertion.scorerKey)) return
    if (ref.configOverride.rubricRef !== undefined) {
      issues.push({
        code: EVAL_SET_FILE_ISSUE.invalidScorerConfig,
        path: `${path}.configOverride.rubricRef`,
        message: 'a case override cannot change rubricRef; declare a separate assertion instead',
      })
      return
    }
    const merged = { ...(assertion.config ?? {}), ...ref.configOverride }
    const parsed = parseScorerConfig(assertion.scorerKey, merged, 'write')
    if (!parsed.ok) {
      for (const issue of parsed.issues) {
        issues.push({ code: EVAL_SET_FILE_ISSUE.invalidScorerConfig, path: `${path}.configOverride`, message: issue })
      }
    }
  })
  return issues
}

export function validateEvalSetFile(
  raw: unknown,
  options: { maxBytes?: number } = {},
): EvalSetFileValidation {
  const envelope = envelopeIssues(raw)
  if (envelope.length > 0) return { ok: false, issues: envelope }

  const maxBytes = options.maxBytes ?? resolveEvalSetMaxBytes()
  const bytes = Buffer.byteLength(canonicalJson(raw), 'utf8')
  if (bytes > maxBytes) {
    return {
      ok: false,
      issues: [
        {
          code: EVAL_SET_FILE_ISSUE.tooLarge,
          path: '',
          message: `eval set file is ${bytes} bytes, above the ${maxBytes}-byte limit (OM_AGENT_EVAL_SET_MAX_BYTES)`,
        },
      ],
    }
  }

  const parsed = evalSetFileSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: EVAL_SET_FILE_ISSUE.schema,
        path: formatPath(issue.path.filter((segment): segment is string | number => typeof segment !== 'symbol')),
        message: issue.message,
      })),
    }
  }

  const file = parsed.data
  const assertionsByKey = new Map(file.assertions.map((assertion) => [assertion.key, assertion]))
  const issues: EvalSetFileIssue[] = [
    ...duplicateKeyIssues(
      file.assertions.map((assertion) => assertion.key),
      'assertions',
      'assertion',
    ),
    ...duplicateKeyIssues(
      file.cases.map((entry) => entry.key),
      'cases',
      'case',
    ),
    ...file.assertions.flatMap((assertion, index) => assertionIssues(file.agentId, assertion, index)),
    ...file.cases.flatMap((entry, index) => caseRefIssues(entry, index, assertionsByKey)),
  ]
  return issues.length > 0 ? { ok: false, issues } : { ok: true, file }
}

/**
 * Every `rubricRef` a raw (not yet validated) eval-set file names, so async
 * callers can load agent rubrics before the synchronous validation runs.
 */
export function collectEvalSetFileRubricRefs(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.assertions)) return []
  return collectRubricRefs(raw.assertions.map((assertion) => (isRecord(assertion) ? assertion.config : null)))
}

export function parseEvalSetFile(raw: unknown, options: { maxBytes?: number } = {}): EvalSetFile {
  const result = validateEvalSetFile(raw, options)
  if (!result.ok) throw new EvalSetFileInvalidError(result.issues)
  return result.file
}

function manifestAssertionFromFile(agentId: string, assertion: EvalSetFileAssertion): EvalSetManifestAssertion {
  const definition = getScorerDefinition(assertion.scorerKey)
  const type = definition?.kind ?? assertion.type ?? 'deterministic'
  const config: Json = assertion.config ?? {}
  const frozen: EvalSetManifestAssertion = {
    id: deterministicAssertionId(agentId, assertion.key),
    key: assertion.key,
    scorerKey: assertion.scorerKey,
    type,
    severity: assertion.severity,
    title: assertion.title,
    config,
  }
  if (type !== 'llm_judge') return frozen
  const rubric = frozenJudgeRubric(config, agentId, assertion.title)
  return rubric ? { ...frozen, rubric } : frozen
}

function manifestCaseFromFile(agentId: string, entry: EvalSetFileCase): EvalSetManifestCase {
  const manifestCase: EvalSetManifestCase = {
    id: deterministicCaseId(agentId, entry.key),
    key: entry.key,
    name: entry.name ?? null,
    input: entry.input,
    expected: entry.expected ?? null,
    assertions:
      entry.assertions === undefined || entry.assertions === null
        ? null
        : entry.assertions.map((ref) => ({
            assertionId: deterministicAssertionId(agentId, ref.key),
            configOverride: ref.configOverride ?? null,
            disabled: ref.disabled === true,
          })),
  }
  if (!entry.fixtures || (entry.fixtures.tools === undefined && entry.fixtures.model === undefined)) {
    return manifestCase
  }
  return { ...manifestCase, fixtures: { ...entry.fixtures } }
}

export function manifestFromFile(
  file: EvalSetFile,
  options: { maxBytes?: number } = {},
): { manifest: EvalSetManifest; version: string } {
  const manifest = normalizeManifest({
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: file.agentId,
    label: file.label ?? null,
    source: 'file',
    assertions: file.assertions.map((assertion) => manifestAssertionFromFile(file.agentId, assertion)),
    cases: file.cases.map((entry) => manifestCaseFromFile(file.agentId, entry)),
  })
  assertManifestWithinCap(manifest, options.maxBytes ?? resolveEvalSetMaxBytes())
  return { manifest, version: hashManifest(manifest) }
}

function toJsonObject(value: Json): Record<string, Json> {
  return isRecord(value) ? (value as Record<string, Json>) : {}
}

export function fileFromManifest(manifest: EvalSetManifest): EvalSetFile {
  const normalized = normalizeManifest(manifest)
  const keysById = new Map(normalized.assertions.map((assertion) => [assertion.id, assertion.key]))
  const assertions: EvalSetFileAssertion[] = normalized.assertions.map((assertion) => ({
    key: assertion.key,
    scorerKey: assertion.scorerKey,
    type: assertion.type,
    severity: assertion.severity,
    title: assertion.title,
    config: toJsonObject(assertion.config),
  }))
  const cases: EvalSetFileCase[] = normalized.cases.map((entry) => {
    const fileCase: EvalSetFileCase = { key: entry.key, input: entry.input }
    if (entry.name !== null) fileCase.name = entry.name
    if (entry.expected !== null) fileCase.expected = entry.expected
    if (entry.assertions !== null) {
      fileCase.assertions = entry.assertions.flatMap((ref) => {
        const key = keysById.get(ref.assertionId)
        if (!key) return []
        const fileRef: EvalSetFileCaseAssertionRef = { key }
        if (ref.configOverride) fileRef.configOverride = toJsonObject(ref.configOverride as Json)
        if (ref.disabled === true) fileRef.disabled = true
        return [fileRef]
      })
    }
    if (entry.fixtures && (entry.fixtures.tools !== undefined || entry.fixtures.model !== undefined)) {
      fileCase.fixtures = { ...entry.fixtures }
    }
    return fileCase
  })
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: normalized.agentId,
    ...(normalized.label !== null ? { label: normalized.label } : {}),
    assertions,
    cases,
  }
}
