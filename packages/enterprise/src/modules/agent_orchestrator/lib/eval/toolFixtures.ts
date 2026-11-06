import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  computeToolArgsKey,
  type ToolReplayFixture,
  type ToolReplayMiss,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/tool-replay-context'
import { AgentEvalCase, AgentRun, AgentToolCall } from '../../data/entities'

export const EVAL_TOOL_FIXTURE_FORMAT = 'open-mercato.agent-eval-tool-fixtures'
export const EVAL_TOOL_FIXTURE_FORMAT_VERSION = 1
export const EVAL_TOOL_FIXTURE_MAX_ENTRIES = 1000
export const DEFAULT_EVAL_TOOL_FIXTURE_MAX_BYTES = 5 * 1024 * 1024
export const EVAL_TOOL_FIXTURE_FILE_SUFFIX = '.tools.json'

export const TOOL_FIXTURE_MISSING = 'tool_fixture_missing'
export const TOOL_REPLAY_MUTATION_REFUSED = 'tool_replay_mutation_refused'
export const TOOL_FIXTURE_INVALID = 'tool_fixture_invalid'
export const TOOL_FIXTURE_RECORD_FAILED = 'tool_fixture_record_failed'

export type EvalToolMode = 'live' | 'replay' | 'record' | 'mixed' | 'unsupported_runtime'
export type EvalToolFixtureFidelity = 'full' | 'summary'

const toolFixtureEntrySchema = z.object({
  toolName: z.string().min(1).max(200),
  argsKey: z.string().max(128).optional(),
  args: z.unknown(),
  output: z.unknown(),
  error: z.object({ message: z.string().max(4000) }).nullable().optional(),
  occurrence: z.number().int().min(0),
  toolCallId: z.string().max(200).nullable().optional(),
})

export const evalToolFixtureFileSchema = z.object({
  format: z.literal(EVAL_TOOL_FIXTURE_FORMAT),
  formatVersion: z.literal(EVAL_TOOL_FIXTURE_FORMAT_VERSION),
  agentId: z.string().min(1).max(100),
  caseKey: z.string().min(1).max(200),
  containsTenantData: z.boolean(),
  fidelity: z.enum(['full', 'summary']),
  recordedAt: z.string().max(40),
  fixtures: z.array(toolFixtureEntrySchema).max(EVAL_TOOL_FIXTURE_MAX_ENTRIES),
})

export type EvalToolFixtureFile = z.infer<typeof evalToolFixtureFileSchema>

export type EvalToolFixtureCaseRef = {
  agentId: string
  caseKey: string
  fixturePath: string | null
  trialIndex: number
}

export type EvalToolFixtureLoad =
  | { ok: true; fixtures: ToolReplayFixture[]; fidelity: EvalToolFixtureFidelity }
  | { ok: false; reason: 'not_configured' | 'not_found' }
  | { ok: false; reason: 'invalid'; message: string }

export type EvalToolFixtureStore = {
  load: (ref: EvalToolFixtureCaseRef) => Promise<EvalToolFixtureLoad>
  save: (ref: EvalToolFixtureCaseRef, fixtures: ToolReplayFixture[]) => Promise<void>
}

/**
 * In-process tool fixture options for one eval suite replay. Only the CLI builds
 * them (fixtures live on the operator's disk); the HTTP API and the queue worker
 * never accept a fixture location, so a request can never make the server read
 * or write arbitrary paths.
 */
export type EvalToolFixtureOptions =
  | { mode: 'record'; store: EvalToolFixtureStore }
  | { mode: 'replay'; store: EvalToolFixtureStore; onMiss: 'error' | 'live' }

export type EvalCaseToolOutcome = {
  mode: EvalToolMode
  misses: number
  summaryFidelity: boolean
}

export function resolveEvalToolFixtureMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OM_AGENT_EVAL_TOOL_FIXTURE_MAX_BYTES
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EVAL_TOOL_FIXTURE_MAX_BYTES
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/

/**
 * Maps an agent id or case key to one file-name segment. Keys that are already
 * safe are kept verbatim so recorded files stay readable; anything else (path
 * separators, `..`, unicode) becomes a stable hash-derived name.
 */
export function fixtureFileSegment(value: string): string {
  if (SAFE_SEGMENT.test(value) && !value.includes('..')) return value
  return `key-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)}`
}

export function conventionalToolFixturePath(dir: string, agentId: string, caseKey: string): string {
  return path.join(path.resolve(dir), fixtureFileSegment(agentId), `${fixtureFileSegment(caseKey)}${EVAL_TOOL_FIXTURE_FILE_SUFFIX}`)
}

function isInside(baseDir: string, target: string): boolean {
  const relative = path.relative(baseDir, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Normalizes parsed entries into replay fixtures. `argsKey` is recomputed from
 * `args`, so a hand-edited fixture can never carry a stale key, and occurrences
 * must be unique per `(toolName, argsKey)` for strict matching to be unambiguous.
 */
export function normalizeToolFixtures(
  entries: ReadonlyArray<z.infer<typeof toolFixtureEntrySchema>>,
): { ok: true; fixtures: ToolReplayFixture[] } | { ok: false; message: string } {
  const seen = new Set<string>()
  const fixtures: ToolReplayFixture[] = []
  for (const entry of entries) {
    const argsKey = computeToolArgsKey(entry.args ?? null)
    const identity = `${entry.toolName}\u0000${argsKey}\u0000${entry.occurrence}`
    if (seen.has(identity)) {
      return { ok: false, message: `duplicate fixture for tool "${entry.toolName}" occurrence ${entry.occurrence}` }
    }
    seen.add(identity)
    fixtures.push({
      toolName: entry.toolName,
      argsKey,
      args: entry.args ?? null,
      output: entry.output ?? null,
      error: entry.error ?? null,
      occurrence: entry.occurrence,
      toolCallId: entry.toolCallId ?? null,
    })
  }
  return { ok: true, fixtures }
}

export function parseToolFixtureText(text: string): EvalToolFixtureLoad {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid', message: 'not valid JSON' }
  }
  const parsed = evalToolFixtureFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: 'invalid', message: `${issue?.path.join('.') || '.'}: ${issue?.message ?? 'invalid'}` }
  }
  const normalized = normalizeToolFixtures(parsed.data.fixtures)
  if (!normalized.ok) return { ok: false, reason: 'invalid', message: normalized.message }
  return { ok: true, fixtures: normalized.fixtures, fidelity: parsed.data.fidelity }
}

export function buildToolFixtureFile(input: {
  agentId: string
  caseKey: string
  fixtures: ReadonlyArray<ToolReplayFixture>
  fidelity?: EvalToolFixtureFidelity
  now?: Date
}): EvalToolFixtureFile {
  return {
    format: EVAL_TOOL_FIXTURE_FORMAT,
    formatVersion: EVAL_TOOL_FIXTURE_FORMAT_VERSION,
    agentId: input.agentId,
    caseKey: input.caseKey,
    containsTenantData: true,
    fidelity: input.fidelity ?? 'full',
    recordedAt: (input.now ?? new Date()).toISOString(),
    fixtures: input.fixtures.map((fixture) => ({
      toolName: fixture.toolName,
      argsKey: fixture.argsKey,
      args: fixture.args ?? null,
      output: fixture.output ?? null,
      error: fixture.error ?? null,
      occurrence: fixture.occurrence,
      toolCallId: fixture.toolCallId ?? null,
    })),
  }
}

export class EvalToolFixtureTooLargeError extends Error {
  readonly code = TOOL_FIXTURE_RECORD_FAILED

  constructor(readonly bytes: number, readonly maxBytes: number) {
    super(
      `[internal] ${TOOL_FIXTURE_RECORD_FAILED}: fixture file is ${bytes} bytes, above the ${maxBytes}-byte limit (OM_AGENT_EVAL_TOOL_FIXTURE_MAX_BYTES)`,
    )
    this.name = 'EvalToolFixtureTooLargeError'
  }
}

export function serializeToolFixtureFile(file: EvalToolFixtureFile, maxBytes = resolveEvalToolFixtureMaxBytes()): string {
  if (file.fixtures.length > EVAL_TOOL_FIXTURE_MAX_ENTRIES) {
    throw new Error(
      `[internal] ${TOOL_FIXTURE_RECORD_FAILED}: ${file.fixtures.length} tool calls exceed the ${EVAL_TOOL_FIXTURE_MAX_ENTRIES}-entry limit`,
    )
  }
  const text = `${JSON.stringify(file, null, 2)}\n`
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) throw new EvalToolFixtureTooLargeError(bytes, maxBytes)
  return text
}

export function writeToolFixtureFile(filePath: string, file: EvalToolFixtureFile, maxBytes?: number): void {
  const text = serializeToolFixtureFile(file, maxBytes)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600 })
}

export function readToolFixtureFile(filePath: string, maxBytes = resolveEvalToolFixtureMaxBytes()): EvalToolFixtureLoad {
  let fd: number | null = null
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0))
    const stats = fs.fstatSync(fd)
    if (!stats.isFile()) return { ok: false, reason: 'invalid', message: 'not a regular file' }
    if (stats.size > maxBytes) {
      return { ok: false, reason: 'invalid', message: `file is above the ${maxBytes}-byte limit (OM_AGENT_EVAL_TOOL_FIXTURE_MAX_BYTES)` }
    }
    const buffer = Buffer.alloc(stats.size)
    let total = 0
    while (total < buffer.length) {
      const read = fs.readSync(fd, buffer, total, buffer.length - total, null)
      if (read === 0) break
      total += read
    }
    return parseToolFixtureText(buffer.subarray(0, total).toString('utf8'))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null
    if (code === 'ENOENT') return { ok: false, reason: 'not_found' }
    return { ok: false, reason: 'invalid', message: `cannot read file${code ? ` (${code})` : ''}` }
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}

/**
 * File-system fixture store for the CLI. Replay resolution: an explicit
 * `--replay <dir>` wins (`<dir>/<agentId>/<caseKey>.tools.json`); otherwise a
 * case's own `fixtures.tools` path resolves against the eval-set file directory
 * and may not leave it. A case with neither runs live. Record always writes the
 * conventional path under `recordDir`.
 */
export function createFileToolFixtureStore(options: {
  replayDir?: string | null
  recordDir?: string | null
  evalSetDir?: string | null
  maxBytes?: number
}): EvalToolFixtureStore & { resolveReplayPath: (ref: EvalToolFixtureCaseRef) => string | null } {
  const maxBytes = options.maxBytes ?? resolveEvalToolFixtureMaxBytes()
  const resolveReplayPath = (ref: EvalToolFixtureCaseRef): string | null => {
    if (options.replayDir) return conventionalToolFixturePath(options.replayDir, ref.agentId, ref.caseKey)
    if (ref.fixturePath && options.evalSetDir) {
      const baseDir = path.resolve(options.evalSetDir)
      const target = path.resolve(baseDir, ref.fixturePath)
      return isInside(baseDir, target) ? target : null
    }
    return null
  }
  return {
    resolveReplayPath,
    async load(ref) {
      const filePath = resolveReplayPath(ref)
      if (!filePath && ref.fixturePath && options.evalSetDir) {
        return { ok: false, reason: 'invalid', message: `fixtures.tools path "${ref.fixturePath}" leaves the eval set directory` }
      }
      if (!filePath) return { ok: false, reason: 'not_configured' }
      return readToolFixtureFile(filePath, maxBytes)
    },
    async save(ref, fixtures) {
      if (!options.recordDir) throw new Error(`[internal] ${TOOL_FIXTURE_RECORD_FAILED}: no record directory`)
      const file = buildToolFixtureFile({ agentId: ref.agentId, caseKey: ref.caseKey, fixtures })
      writeToolFixtureFile(conventionalToolFixturePath(options.recordDir, ref.agentId, ref.caseKey), file, maxBytes)
    },
  }
}

export function describeToolReplayMisses(misses: ReadonlyArray<ToolReplayMiss>): string | null {
  const refused = misses.filter((miss) => miss.reason === 'mutation_refused')
  if (refused.length) {
    const names = Array.from(new Set(refused.map((miss) => miss.toolName))).join(', ')
    return `[internal] ${TOOL_REPLAY_MUTATION_REFUSED}: mutation tool(s) ${names} cannot run under tool replay`
  }
  const failed = misses.filter((miss) => miss.reason === 'fixture_missing' && miss.resolution === 'error')
  if (!failed.length) return null
  const names = Array.from(new Set(failed.map((miss) => miss.toolName))).join(', ')
  return `[internal] ${TOOL_FIXTURE_MISSING}: no recorded result for ${failed.length} tool call(s) (${names})`
}

/**
 * Suite-level tool mode from the per-case modes: a single mode when every case
 * agrees, `mixed` when any case fell back to live tools or cases disagree.
 */
export function aggregateEvalToolMode(modes: ReadonlyArray<EvalToolMode>): EvalToolMode {
  if (!modes.length) return 'live'
  if (modes.includes('mixed')) return 'mixed'
  const distinct = new Set(modes)
  return distinct.size === 1 ? modes[0] : 'mixed'
}

export type StoredRunFixtures = { agentId: string; fixtures: ToolReplayFixture[] }

/**
 * Best-effort fixture export from a stored run (`--fixtures-from-run`). Stored
 * tool calls keep request/response SUMMARIES that ingestion may redact or
 * truncate, so the result is always `fidelity: 'summary'`; recording at
 * execution time is the faithful path.
 */
export async function buildToolFixturesFromRun(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  runId: string,
): Promise<StoredRunFixtures | null> {
  const run = await findOneWithDecryption(em, AgentRun, { id: runId, ...scope }, undefined, scope)
  if (!run) return null
  const toolCalls = await findWithDecryption(
    em,
    AgentToolCall,
    { agentRunId: run.id, ...scope },
    { orderBy: { createdAt: 'ASC' } },
    scope,
  )
  const occurrences = new Map<string, number>()
  const fixtures = toolCalls.slice(0, EVAL_TOOL_FIXTURE_MAX_ENTRIES).map((call): ToolReplayFixture => {
    const args = call.requestSummary ?? null
    const argsKey = computeToolArgsKey(args)
    const counterKey = `${call.toolName}\u0000${argsKey}`
    const occurrence = occurrences.get(counterKey) ?? 0
    occurrences.set(counterKey, occurrence + 1)
    const failed = call.status !== 'ok'
    return {
      toolName: call.toolName,
      argsKey,
      args,
      output: failed ? null : call.responseSummary ?? null,
      error: failed ? { message: call.errorMessage ?? String(call.status) } : null,
      occurrence,
      toolCallId: null,
    }
  })
  return { agentId: run.agentId, fixtures }
}

/** The DB case key of a run's eval case (cases created from a run keep it as `sourceId`). */
export async function findEvalCaseKeyForRun(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  runId: string,
): Promise<string | null> {
  const evalCase = await em.findOne(AgentEvalCase, { ...scope, sourceId: runId, deletedAt: null })
  return evalCase?.id ?? null
}

export type EvalCliToolFixtureFlags = {
  record?: string
  replay?: string
  onFixtureMiss?: string
  fixturesFromRun?: string
  casesFile?: { cases: ReadonlyArray<{ fixtures?: { tools?: string } | null }> } | null
  evalSetDir?: string | null
}

export type EvalCliToolFixtureResult =
  | { ok: true; options: EvalToolFixtureOptions | null; recordDir: string | null; implicitReplay: boolean }
  | { ok: false; message: string }

/**
 * Parses the eval CLI `--record`, `--replay`, `--on-fixture-miss` and
 * `--fixtures-from-run` flags. A `--cases` file whose cases reference
 * `fixtures.tools` replays those fixtures without `--replay`; cases without a
 * reference then run live and the suite reports `mixed`.
 */
export function parseEvalCliToolFixtureFlags(flags: EvalCliToolFixtureFlags): EvalCliToolFixtureResult {
  if (flags.record !== undefined && flags.replay !== undefined) {
    return { ok: false, message: '--record and --replay are mutually exclusive' }
  }
  if (flags.onFixtureMiss !== undefined && flags.onFixtureMiss !== 'error' && flags.onFixtureMiss !== 'live') {
    return { ok: false, message: '--on-fixture-miss takes error or live' }
  }
  if (flags.fixturesFromRun !== undefined && flags.record === undefined) {
    return { ok: false, message: '--fixtures-from-run requires --record <dir>' }
  }
  if (flags.record !== undefined) {
    if (flags.onFixtureMiss !== undefined) return { ok: false, message: '--on-fixture-miss applies to replay only' }
    const recordDir = path.resolve(flags.record)
    return {
      ok: true,
      recordDir,
      implicitReplay: false,
      options: { mode: 'record', store: createFileToolFixtureStore({ recordDir }) },
    }
  }
  const implicitReplay =
    flags.replay === undefined &&
    Boolean(flags.evalSetDir) &&
    Boolean(flags.casesFile?.cases.some((entry) => Boolean(entry.fixtures?.tools)))
  if (flags.replay === undefined && !implicitReplay) {
    if (flags.onFixtureMiss !== undefined) {
      return { ok: false, message: '--on-fixture-miss requires --replay <dir> or a --cases file with fixtures.tools' }
    }
    return { ok: true, options: null, recordDir: null, implicitReplay: false }
  }
  const onMiss = flags.onFixtureMiss === 'live' ? 'live' : 'error'
  return {
    ok: true,
    recordDir: null,
    implicitReplay,
    options: {
      mode: 'replay',
      onMiss,
      store: createFileToolFixtureStore({
        replayDir: flags.replay ? path.resolve(flags.replay) : null,
        evalSetDir: flags.evalSetDir ?? null,
      }),
    },
  }
}

export const EVAL_TOOL_FIXTURE_TENANT_DATA_WARNING =
  'Tool fixtures contain recorded tool outputs, which can include decrypted tenant data. Commit only fixtures built from synthetic or public data.'
