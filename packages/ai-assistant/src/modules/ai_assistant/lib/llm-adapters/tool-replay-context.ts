import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { canonicalJsonStringify } from '../agent-definition-hash'

/**
 * One recorded tool call. `argsKey` is the SHA-256 of the canonical JSON of
 * `args`; `occurrence` is the 0-based index of this call among earlier calls
 * with the same `(toolName, argsKey)` inside one bound context. `output` is
 * the handler result after emitted UI parts were merged, so replay reproduces
 * cards and citations exactly.
 */
export type ToolReplayFixture = {
  toolName: string
  argsKey: string
  args: unknown
  output: unknown
  error?: { message: string } | null
  occurrence: number
  toolCallId?: string | null
}

export type ToolReplayMissReason = 'fixture_missing' | 'mutation_refused'

export type ToolReplayMiss = {
  toolName: string
  argsKey: string
  args: unknown
  occurrence: number
  toolCallId: string | null
  reason: ToolReplayMissReason
  resolution: 'error' | 'live'
}

export type ToolReplayContext =
  | {
      mode: 'replay'
      fixtures: ToolReplayFixture[]
      match: 'strict' | 'ordered'
      onMiss: 'error' | 'live'
      observeMiss?: (miss: ToolReplayMiss) => void
    }
  | {
      mode: 'record'
      sink: (fixture: ToolReplayFixture) => void
    }

export type ToolReplayErrorCode = 'tool_fixture_missing' | 'tool_replay_mutation_refused'

export class ToolReplayError extends Error {
  readonly code: ToolReplayErrorCode
  readonly toolName: string

  constructor(code: ToolReplayErrorCode, toolName: string, message: string) {
    super(message)
    this.name = 'ToolReplayError'
    this.code = code
    this.toolName = toolName
  }
}

type ToolReplayScope = {
  context: ToolReplayContext
  occurrencesByArgs: Map<string, number>
  occurrencesByTool: Map<string, number>
}

const TOOL_REPLAY_STORAGE_KEY = Symbol.for('@open-mercato/ai-assistant/tool-replay-context')

type GlobalWithToolReplayStorage = typeof globalThis & {
  [TOOL_REPLAY_STORAGE_KEY]?: AsyncLocalStorage<ToolReplayScope>
}

function resolveToolReplayStorage(): AsyncLocalStorage<ToolReplayScope> {
  const scope = globalThis as GlobalWithToolReplayStorage
  if (!scope[TOOL_REPLAY_STORAGE_KEY]) {
    scope[TOOL_REPLAY_STORAGE_KEY] = new AsyncLocalStorage<ToolReplayScope>()
  }
  return scope[TOOL_REPLAY_STORAGE_KEY]
}

const toolReplayStorage = resolveToolReplayStorage()

/**
 * Binds a tool record/replay context for every agent tool call executed inside
 * `fn`. Each binding gets its own occurrence counters, so concurrent or nested
 * runs never share state. Outside a binding tool execution is unchanged.
 */
export function withToolReplayContext<T>(context: ToolReplayContext, fn: () => Promise<T>): Promise<T> {
  const scope: ToolReplayScope = {
    context,
    occurrencesByArgs: new Map(),
    occurrencesByTool: new Map(),
  }
  return toolReplayStorage.run(scope, fn)
}

export function getToolReplayContext(): ToolReplayContext | null {
  return toolReplayStorage.getStore()?.context ?? null
}

export function computeToolArgsKey(args: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(args)).digest('hex')
}

export type ToolReplayCall = {
  toolName: string
  args: unknown
  argsKey: string
  occurrence: number
  ordinal: number
  toolCallId: string | null
}

export type ToolReplayDecision =
  | { kind: 'live' }
  | { kind: 'replay'; fixture: ToolReplayFixture }
  | { kind: 'record'; call: ToolReplayCall; sink: (fixture: ToolReplayFixture) => void }
  | { kind: 'miss_live'; call: ToolReplayCall }

function claimCall(scope: ToolReplayScope, toolName: string, args: unknown, toolCallId: string | null): ToolReplayCall {
  const argsKey = computeToolArgsKey(args)
  const argsCounterKey = `${toolName}\u0000${argsKey}`
  const occurrence = scope.occurrencesByArgs.get(argsCounterKey) ?? 0
  scope.occurrencesByArgs.set(argsCounterKey, occurrence + 1)
  const ordinal = scope.occurrencesByTool.get(toolName) ?? 0
  scope.occurrencesByTool.set(toolName, ordinal + 1)
  return { toolName, args, argsKey, occurrence, ordinal, toolCallId }
}

function findFixture(
  context: Extract<ToolReplayContext, { mode: 'replay' }>,
  call: ToolReplayCall,
): ToolReplayFixture | null {
  if (context.match === 'ordered') {
    const sameTool = context.fixtures.filter((fixture) => fixture.toolName === call.toolName)
    return sameTool[call.ordinal] ?? null
  }
  return (
    context.fixtures.find(
      (fixture) =>
        fixture.toolName === call.toolName &&
        fixture.argsKey === call.argsKey &&
        fixture.occurrence === call.occurrence,
    ) ?? null
  )
}

function reportMiss(
  context: Extract<ToolReplayContext, { mode: 'replay' }>,
  call: ToolReplayCall,
  reason: ToolReplayMissReason,
  resolution: 'error' | 'live',
): void {
  if (!context.observeMiss) return
  try {
    context.observeMiss({
      toolName: call.toolName,
      argsKey: call.argsKey,
      args: call.args,
      occurrence: call.occurrence,
      toolCallId: call.toolCallId,
      reason,
      resolution,
    })
  } catch {
    return
  }
}

/**
 * Decides how the agent tool wrapper handles one call under the ambient
 * context. Replay refuses `isMutation` tools outright (a replayed run must
 * never write or queue an approval) and throws `tool_fixture_missing` on a
 * miss unless `onMiss: 'live'`, in which case the real tool runs and the miss
 * is reported through `observeMiss`.
 */
export function resolveToolReplayDecision(input: {
  toolName: string
  args: unknown
  isMutation: boolean
  toolCallId: string | null
}): ToolReplayDecision {
  const scope = toolReplayStorage.getStore()
  if (!scope) return { kind: 'live' }
  const call = claimCall(scope, input.toolName, input.args, input.toolCallId)
  const { context } = scope
  if (context.mode === 'record') {
    return { kind: 'record', call, sink: context.sink }
  }
  if (input.isMutation) {
    reportMiss(context, call, 'mutation_refused', 'error')
    throw new ToolReplayError(
      'tool_replay_mutation_refused',
      input.toolName,
      `[internal] tool_replay_mutation_refused: mutation tool "${input.toolName}" cannot run under tool replay`,
    )
  }
  const fixture = findFixture(context, call)
  if (fixture) return { kind: 'replay', fixture }
  if (context.onMiss === 'live') {
    reportMiss(context, call, 'fixture_missing', 'live')
    return { kind: 'miss_live', call }
  }
  reportMiss(context, call, 'fixture_missing', 'error')
  throw new ToolReplayError(
    'tool_fixture_missing',
    input.toolName,
    `[internal] tool_fixture_missing: no recorded result for tool "${input.toolName}" (occurrence ${call.occurrence})`,
  )
}

export function buildRecordedToolFixture(
  call: ToolReplayCall,
  outcome: { output: unknown } | { error: string },
): ToolReplayFixture {
  return {
    toolName: call.toolName,
    argsKey: call.argsKey,
    args: call.args,
    output: 'output' in outcome ? outcome.output : null,
    error: 'error' in outcome ? { message: outcome.error } : null,
    occurrence: call.occurrence,
    toolCallId: call.toolCallId,
  }
}

export function emitRecordedToolFixture(
  sink: (fixture: ToolReplayFixture) => void,
  fixture: ToolReplayFixture,
): void {
  try {
    sink(fixture)
  } catch {
    return
  }
}
