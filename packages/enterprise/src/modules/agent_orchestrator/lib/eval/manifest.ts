import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentEvalAssertion, AgentEvalCase, AgentEvalSuiteRun } from '../../data/entities'
import { EVAL_SET_SNAPSHOT_LATEST, evalCaseAssertionRefSchema, type EvalSetSnapshot } from '../../data/validators'
import { parseCaseAssertionRefs, resolveEffectiveAssertions } from './assertionResolution'
import { canonicalInputKey, canonicalJson } from './canonicalInputKey'
import { judgeRubricSchema, normalizeJudgeRubric, type JudgeRubric } from './judgeRubric'
import { parseScorerConfig, resolveScorerKey } from './registry'
import type { Json } from './types'

export const EVAL_SET_FORMAT = 'open-mercato.agent-eval-set' as const
export const EVAL_SET_FORMAT_VERSION = 1 as const
export const EVAL_SET_SUMMARY_KEY = '__evalSet' as const
export const EVAL_SET_ID_NAMESPACE = 'bbeef26f-47cc-4b5a-8611-f45015ced67e'
export const DEFAULT_EVAL_SET_MAX_BYTES = 5242880
export const EVAL_SET_UNRESOLVED = 'eval_set_unresolved' as const
export const EVAL_SET_CASE_MISSING = 'eval_set_case_missing' as const

const CARRIER_SCAN_LIMIT = 200

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

export const evalSetManifestAssertionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(100),
  scorerKey: z.string().min(1).max(100),
  type: z.enum(['deterministic', 'llm_judge']),
  severity: z.enum(['gate', 'warn']),
  title: z.string().min(1).max(200),
  config: jsonSchema,
  rubric: judgeRubricSchema.optional(),
})

export const evalSetManifestCaseSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(200),
  name: z.string().nullable(),
  input: jsonSchema,
  expected: jsonSchema.nullable(),
  assertions: z.array(evalCaseAssertionRefSchema).nullable(),
  fixtures: z
    .object({ tools: z.string().min(1).optional(), model: z.string().min(1).optional() })
    .optional(),
})

export const evalSetManifestSchema = z.object({
  format: z.literal(EVAL_SET_FORMAT),
  formatVersion: z.literal(EVAL_SET_FORMAT_VERSION),
  agentId: z.string().min(1).max(100),
  label: z.string().nullable(),
  source: z.enum(['db', 'file']),
  assertions: z.array(evalSetManifestAssertionSchema),
  cases: z.array(evalSetManifestCaseSchema),
})

export type EvalSetManifest = z.infer<typeof evalSetManifestSchema>
export type EvalSetManifestAssertion = z.infer<typeof evalSetManifestAssertionSchema>
export type EvalSetManifestCase = z.infer<typeof evalSetManifestCaseSchema>

export type EvalSetPointer = {
  version: string
  label: string | null
  source: 'db' | 'file'
  caseCount: number
  assertionCount: number
  carrierSuiteRunId: string | null
  body?: unknown
}

export type ManifestScope = { tenantId: string; organizationId: string }

export class EvalSetTooLargeError extends Error {
  readonly code = 'eval_set_too_large'

  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(`[internal] eval set manifest is ${bytes} bytes, above the ${maxBytes}-byte limit (OM_AGENT_EVAL_SET_MAX_BYTES)`)
    this.name = 'EvalSetTooLargeError'
  }
}

export class EvalSetUnresolvedError extends Error {
  readonly code = EVAL_SET_UNRESOLVED

  constructor(readonly snapshot: string) {
    super(`[internal] eval set snapshot ${snapshot} is not known for this agent in this organization`)
    this.name = 'EvalSetUnresolvedError'
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function toJson(value: unknown): Json {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as Json
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}

export function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const digest = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes)
}

export function deterministicCaseId(agentId: string, key: string): string {
  return uuidV5(EVAL_SET_ID_NAMESPACE, `case:${agentId}:${key}`)
}

export function deterministicAssertionId(agentId: string, key: string): string {
  return uuidV5(EVAL_SET_ID_NAMESPACE, `assertion:${agentId}:${key}`)
}

export function resolveEvalSetMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OM_AGENT_EVAL_SET_MAX_BYTES
  if (!raw) return DEFAULT_EVAL_SET_MAX_BYTES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EVAL_SET_MAX_BYTES
}

export function normalizeManifest(manifest: EvalSetManifest): EvalSetManifest {
  const assertions = [...manifest.assertions].sort(
    (left, right) => compareText(left.key, right.key) || compareText(left.id, right.id),
  )
  const cases = [...manifest.cases]
    .sort((left, right) => compareText(left.key, right.key) || compareText(left.id, right.id))
    .map((entry) =>
      entry.assertions
        ? {
            ...entry,
            assertions: [...entry.assertions].sort((left, right) =>
              compareText(left.assertionId, right.assertionId),
            ),
          }
        : entry,
    )
  return { ...manifest, assertions, cases }
}

export function manifestByteSize(manifest: EvalSetManifest): number {
  return Buffer.byteLength(canonicalJson(normalizeManifest(manifest)), 'utf8')
}

export function assertManifestWithinCap(manifest: EvalSetManifest, maxBytes: number = resolveEvalSetMaxBytes()): void {
  const bytes = manifestByteSize(manifest)
  if (bytes > maxBytes) throw new EvalSetTooLargeError(bytes, maxBytes)
}

export function hashManifest(manifest: EvalSetManifest): string {
  return `sha256:${canonicalInputKey(normalizeManifest(manifest))}`
}

function manifestAssertionFrom(assertion: AgentEvalAssertion, scorerKey: string): EvalSetManifestAssertion {
  const frozen: EvalSetManifestAssertion = {
    id: assertion.id,
    key: assertion.key,
    scorerKey,
    type: assertion.type,
    severity: assertion.severity,
    title: assertion.title,
    config: toJson(assertion.config ?? {}),
  }
  if (assertion.type !== 'llm_judge') return frozen
  const rubric = normalizeJudgeRubric(assertion.config, assertion.description?.trim() || assertion.title)
  return rubric ? { ...frozen, rubric } : frozen
}

function manifestCaseFrom(evalCase: AgentEvalCase): EvalSetManifestCase {
  return {
    id: evalCase.id,
    key: evalCase.id,
    name: evalCase.name ?? null,
    input: toJson(evalCase.input),
    expected: evalCase.expected === undefined || evalCase.expected === null ? null : toJson(evalCase.expected),
    assertions:
      evalCase.assertions === undefined || evalCase.assertions === null
        ? null
        : parseCaseAssertionRefs(evalCase.assertions).map((ref) => ({
            assertionId: ref.assertionId,
            configOverride: ref.configOverride ?? null,
            disabled: ref.disabled === true,
          })),
  }
}

export async function freezeManifest(
  em: EntityManager,
  scope: ManifestScope,
  options: { agentId: string; label?: string | null; maxBytes?: number },
): Promise<{ manifest: EvalSetManifest; version: string }> {
  const { agentId } = options
  const cases = await findWithDecryption(
    em,
    AgentEvalCase,
    { ...scope, agentDefinitionId: agentId, status: 'approved', deletedAt: null },
    undefined,
    scope,
  )
  const assertions = await findWithDecryption(
    em,
    AgentEvalAssertion,
    { ...scope, appliesTo: { $in: [agentId, '*'] }, enabled: true, deletedAt: null },
    undefined,
    scope,
  )
  const effective = resolveEffectiveAssertions(assertions, [])

  const manifest = normalizeManifest({
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId,
    label: options.label ?? null,
    source: 'db',
    assertions: effective.map((entry) => manifestAssertionFrom(entry.assertion, entry.scorerKey)),
    cases: cases.map(manifestCaseFrom),
  })
  assertManifestWithinCap(manifest, options.maxBytes ?? resolveEvalSetMaxBytes())
  return { manifest, version: hashManifest(manifest) }
}

export async function resolveSnapshotPin(
  em: EntityManager,
  scope: ManifestScope,
  agentId: string,
  snapshot: EvalSetSnapshot,
  options: { maxBytes?: number } = {},
): Promise<{ manifest: EvalSetManifest; version: string }> {
  if (snapshot === EVAL_SET_SNAPSHOT_LATEST) return freezeManifest(em, scope, { agentId, maxBytes: options.maxBytes })
  const manifest = await resolveManifest(em, scope, agentId, snapshot)
  if (!manifest) throw new EvalSetUnresolvedError(snapshot)
  return { manifest, version: snapshot }
}

export function readEvalSetPointer(summary: unknown): EvalSetPointer | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const raw = (summary as Record<string, unknown>)[EVAL_SET_SUMMARY_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const pointer = raw as Record<string, unknown>
  if (typeof pointer.version !== 'string') return null
  return {
    version: pointer.version,
    label: typeof pointer.label === 'string' ? pointer.label : null,
    source: pointer.source === 'file' ? 'file' : 'db',
    caseCount: typeof pointer.caseCount === 'number' ? pointer.caseCount : 0,
    assertionCount: typeof pointer.assertionCount === 'number' ? pointer.assertionCount : 0,
    carrierSuiteRunId: typeof pointer.carrierSuiteRunId === 'string' ? pointer.carrierSuiteRunId : null,
    ...(pointer.body !== undefined ? { body: pointer.body } : {}),
  }
}

function verifiedBody(body: unknown, agentId: string, version: string): EvalSetManifest | null {
  const parsed = evalSetManifestSchema.safeParse(body)
  if (!parsed.success) return null
  if (parsed.data.agentId !== agentId) return null
  const normalized = normalizeManifest(parsed.data)
  return hashManifest(normalized) === version ? normalized : null
}

async function bodyFromCandidates(
  em: EntityManager,
  scope: ManifestScope,
  agentId: string,
  version: string,
  candidates: ReadonlyArray<AgentEvalSuiteRun>,
): Promise<EvalSetManifest | null> {
  for (const candidate of candidates) {
    const pointer = readEvalSetPointer(candidate.summary)
    if (!pointer || pointer.version !== version) continue
    if (pointer.body !== undefined) {
      const manifest = verifiedBody(pointer.body, agentId, version)
      if (manifest) return manifest
      continue
    }
    if (!pointer.carrierSuiteRunId || pointer.carrierSuiteRunId === candidate.id) continue
    const carrier = await findOneWithDecryption(
      em,
      AgentEvalSuiteRun,
      { ...scope, id: pointer.carrierSuiteRunId, agentDefinitionId: agentId },
      undefined,
      scope,
    )
    const carrierPointer = carrier ? readEvalSetPointer(carrier.summary) : null
    if (carrierPointer?.version !== version || carrierPointer.body === undefined) continue
    const manifest = verifiedBody(carrierPointer.body, agentId, version)
    if (manifest) return manifest
  }
  return null
}

export async function resolveManifest(
  em: EntityManager,
  scope: ManifestScope,
  agentId: string,
  version: string,
): Promise<EvalSetManifest | null> {
  const pinned = await findWithDecryption(
    em,
    AgentEvalSuiteRun,
    { ...scope, agentDefinitionId: agentId, evalSetVersion: version },
    { orderBy: { createdAt: 'asc' }, limit: CARRIER_SCAN_LIMIT },
    scope,
  )
  const fromPinned = await bodyFromCandidates(em, scope, agentId, version, pinned)
  if (fromPinned) return fromPinned

  const recent = await findWithDecryption(
    em,
    AgentEvalSuiteRun,
    { ...scope, agentDefinitionId: agentId },
    { orderBy: { createdAt: 'desc' }, limit: CARRIER_SCAN_LIMIT },
    scope,
  )
  return bodyFromCandidates(em, scope, agentId, version, recent)
}

export async function findEvalSetCarrier(
  em: EntityManager,
  scope: ManifestScope,
  agentId: string,
  version: string,
): Promise<string | null> {
  const candidates = await findWithDecryption(
    em,
    AgentEvalSuiteRun,
    { ...scope, agentDefinitionId: agentId },
    { orderBy: { createdAt: 'desc' }, limit: CARRIER_SCAN_LIMIT },
    scope,
  )
  for (const candidate of candidates) {
    const pointer = readEvalSetPointer(candidate.summary)
    if (pointer?.version !== version || pointer.body === undefined) continue
    if (verifiedBody(pointer.body, agentId, version)) return candidate.id
  }
  return null
}

export function buildEvalSetPointer(options: {
  manifest: EvalSetManifest
  version: string
  suiteRunId: string
  carrierSuiteRunId: string | null
}): EvalSetPointer {
  const { manifest, version, suiteRunId, carrierSuiteRunId } = options
  const pointer: EvalSetPointer = {
    version,
    label: manifest.label,
    source: manifest.source,
    caseCount: manifest.cases.length,
    assertionCount: manifest.assertions.length,
    carrierSuiteRunId: carrierSuiteRunId ?? suiteRunId,
  }
  return carrierSuiteRunId ? pointer : { ...pointer, body: manifest }
}

export function stripEvalSetBody(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return summary
  const record = summary as Record<string, unknown>
  const entry = record[EVAL_SET_SUMMARY_KEY]
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !('body' in entry)) return summary
  const pointer = { ...(entry as Record<string, unknown>) }
  delete pointer.body
  return { ...record, [EVAL_SET_SUMMARY_KEY]: pointer }
}

export function mergeSuiteSummary(
  existing: unknown,
  aggregate: Record<string, unknown>,
  reservedUpdates: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}
  const reserved = Object.fromEntries(Object.entries(base).filter(([key]) => key.startsWith('__')))
  return { ...base, ...aggregate, ...reserved, ...reservedUpdates }
}

export type ResolvedManifestAssertion = {
  assertion: EvalSetManifestAssertion
  config: unknown
  rubric: JudgeRubric | null
  configError?: string[]
}

function frozenRubric(assertion: EvalSetManifestAssertion, config: unknown, overridden: boolean): JudgeRubric | null {
  if (assertion.type !== 'llm_judge') return null
  if (!overridden && assertion.rubric) return assertion.rubric
  return normalizeJudgeRubric(config, assertion.rubric?.promptTemplate ?? assertion.title)
}

export function resolveManifestCaseAssertions(
  manifest: EvalSetManifest,
  manifestCase: EvalSetManifestCase,
): ResolvedManifestAssertion[] {
  const refsById = new Map((manifestCase.assertions ?? []).map((ref) => [ref.assertionId, ref]))
  const resolved: ResolvedManifestAssertion[] = []
  for (const assertion of manifest.assertions) {
    const ref = refsById.get(assertion.id)
    if (ref?.disabled) continue
    const stored =
      assertion.config && typeof assertion.config === 'object' && !Array.isArray(assertion.config)
        ? (assertion.config as Record<string, unknown>)
        : {}
    const override = ref?.configOverride ?? null
    const config = override ? { ...stored, ...override } : stored
    if (override) {
      const parsed = parseScorerConfig(assertion.scorerKey, config)
      if (!parsed.ok) {
        resolved.push({ assertion, config, rubric: null, configError: parsed.issues })
        continue
      }
    }
    resolved.push({ assertion, config, rubric: frozenRubric(assertion, config, Boolean(override)) })
  }
  return resolved
}
