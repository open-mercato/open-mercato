/**
 * Shared extraction of tool calls and step metadata from an AI SDK step-finish
 * event. AI SDK 7 shapes are read first (`toolCalls[].input`,
 * `toolResults[].output`, `content[]` parts of type `tool-error`); the legacy
 * pre-AI-SDK-5 fields (`args`, `result`, `experimental_toToolResultError`,
 * `startTime` / `endTime`) remain a fallback so older provider adapters and
 * test fixtures keep working.
 *
 * Ordering contract of `extractStepToolCalls`:
 * - one entry per `toolCalls[]` item, in the order the SDK reported them;
 * - results / errors whose `toolCallId` matches no tool call are appended
 *   afterwards (first-appearance order, `toolResults[]` before `content[]`),
 *   so no executed tool is silently dropped;
 * - results / errors without a `toolCallId` cannot be matched and are ignored.
 *
 * Pure module: no DI and no I/O. Phase 1 of spec
 * `2026-10-21-chat-run-tracing-and-citations`.
 */

export type RawStepToolCall = {
  toolCallId?: string
  toolName?: string
  input?: unknown
  args?: unknown
  result?: unknown
  invalid?: boolean
  error?: unknown
  experimental_toToolResultError?: { code?: string; message?: string }
  repairAttempted?: boolean
  startTime?: number
  endTime?: number
}

export type RawStepToolResult = {
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  result?: unknown
}

export type RawStepContentPart = {
  type?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  error?: unknown
  text?: string
}

export type RawStepUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}

export type RawStepEvent = {
  toolCalls?: RawStepToolCall[]
  toolResults?: RawStepToolResult[]
  content?: RawStepContentPart[]
  text?: string
  finishReason?: string
  response?: { modelId?: string }
  model?: { modelId?: string }
  usage?: RawStepUsage
}

export type ToolCallTiming = { startedAt: number; endedAt?: number }

export type ToolCallTimings = ReadonlyMap<string, ToolCallTiming>

export type ExtractedToolCallError = { code: string; message: string }

export type ExtractedToolCall = {
  toolCallId: string | null
  toolName: string
  args: unknown
  result: unknown
  error?: ExtractedToolCallError
  repairAttempted: boolean
  durationMs: number | null
}

export type ExtractedStepMeta = {
  modelId: string
  finishReason: string
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number | null
    reasoningTokens: number | null
  }
}

const UNKNOWN_TOOL_NAME = 'unknown'
const UNKNOWN_ERROR_CODE = 'unknown'

function readStringProperty(value: object, key: string): string | undefined {
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate : undefined
}

export function normalizeToolError(error: unknown): ExtractedToolCallError {
  if (typeof error === 'string') {
    return { code: UNKNOWN_ERROR_CODE, message: error }
  }
  if (error && typeof error === 'object') {
    const code = readStringProperty(error, 'code') ?? readStringProperty(error, 'name')
    const message = readStringProperty(error, 'message') ?? ''
    return { code: code && code.length > 0 ? code : UNKNOWN_ERROR_CODE, message }
  }
  if (error === undefined || error === null) {
    return { code: UNKNOWN_ERROR_CODE, message: '' }
  }
  return { code: UNKNOWN_ERROR_CODE, message: String(error) }
}

function normalizeLegacyError(
  legacy: { code?: string; message?: string },
): ExtractedToolCallError {
  return {
    code: String(legacy.code ?? UNKNOWN_ERROR_CODE),
    message: String(legacy.message ?? ''),
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function readResultValue(entry: RawStepToolResult | RawStepContentPart): unknown {
  if (hasOwn(entry, 'output')) return entry.output
  return (entry as RawStepToolResult).result
}

function resolveDuration(
  toolCallId: string | null,
  legacy: { startTime?: number; endTime?: number },
  timings: ToolCallTimings | undefined,
): number | null {
  if (toolCallId && timings) {
    const timing = timings.get(toolCallId)
    if (timing && typeof timing.endedAt === 'number') {
      return Math.max(0, timing.endedAt - timing.startedAt)
    }
  }
  if (typeof legacy.startTime === 'number' && typeof legacy.endTime === 'number') {
    return Math.max(0, legacy.endTime - legacy.startTime)
  }
  return null
}

function readToolCallId(value: { toolCallId?: string }): string | null {
  return typeof value.toolCallId === 'string' && value.toolCallId.length > 0
    ? value.toolCallId
    : null
}

export function extractStepToolCalls(
  raw: RawStepEvent,
  timings?: ToolCallTimings,
): ExtractedToolCall[] {
  const toolCalls = Array.isArray(raw.toolCalls) ? raw.toolCalls : []
  const toolResults = Array.isArray(raw.toolResults) ? raw.toolResults : []
  const content = Array.isArray(raw.content) ? raw.content : []

  const resultsById = new Map<string, RawStepToolResult | RawStepContentPart>()
  const errorsById = new Map<string, RawStepContentPart>()
  const appearanceOrder = new Set<string>()

  for (const entry of toolResults) {
    const toolCallId = readToolCallId(entry)
    if (!toolCallId) continue
    resultsById.set(toolCallId, entry)
    appearanceOrder.add(toolCallId)
  }
  for (const part of content) {
    const toolCallId = readToolCallId(part)
    if (!toolCallId) continue
    if (part.type === 'tool-error') {
      errorsById.set(toolCallId, part)
      appearanceOrder.add(toolCallId)
    } else if (part.type === 'tool-result' && !resultsById.has(toolCallId)) {
      resultsById.set(toolCallId, part)
      appearanceOrder.add(toolCallId)
    }
  }

  const matchedIds = new Set<string>()
  const extracted: ExtractedToolCall[] = toolCalls.map((call) => {
    const toolCallId = readToolCallId(call)
    if (toolCallId) matchedIds.add(toolCallId)
    const resultEntry = toolCallId ? resultsById.get(toolCallId) : undefined
    const errorPart = toolCallId ? errorsById.get(toolCallId) : undefined

    let error: ExtractedToolCallError | undefined
    if (errorPart) {
      error = normalizeToolError(errorPart.error)
    } else if (call.invalid === true) {
      error = normalizeToolError(call.error)
    } else if (call.experimental_toToolResultError) {
      error = normalizeLegacyError(call.experimental_toToolResultError)
    }

    const args = hasOwn(call, 'input') ? call.input : call.args
    const result = resultEntry ? readResultValue(resultEntry) : call.result

    const record: ExtractedToolCall = {
      toolCallId,
      toolName: call.toolName ?? UNKNOWN_TOOL_NAME,
      args: args ?? {},
      result,
      repairAttempted: call.repairAttempted === true,
      durationMs: resolveDuration(toolCallId, call, timings),
    }
    if (error) record.error = error
    return record
  })

  for (const toolCallId of appearanceOrder) {
    if (matchedIds.has(toolCallId)) continue
    const resultEntry = resultsById.get(toolCallId)
    const errorPart = errorsById.get(toolCallId)
    const record: ExtractedToolCall = {
      toolCallId,
      toolName: errorPart?.toolName ?? resultEntry?.toolName ?? UNKNOWN_TOOL_NAME,
      args: errorPart?.input ?? resultEntry?.input ?? {},
      result: resultEntry ? readResultValue(resultEntry) : undefined,
      repairAttempted: false,
      durationMs: resolveDuration(toolCallId, {}, timings),
    }
    if (errorPart) record.error = normalizeToolError(errorPart.error)
    extracted.push(record)
  }

  return extracted
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function extractStepMeta(raw: RawStepEvent): ExtractedStepMeta {
  const content = Array.isArray(raw.content) ? raw.content : []
  const text =
    typeof raw.text === 'string'
      ? raw.text
      : content
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text as string)
          .join('')
  const usage = raw.usage ?? {}
  return {
    modelId: raw.response?.modelId ?? raw.model?.modelId ?? 'unknown',
    finishReason: raw.finishReason ?? 'stop',
    text,
    usage: {
      inputTokens: readFiniteNumber(usage.inputTokens) ?? 0,
      outputTokens: readFiniteNumber(usage.outputTokens) ?? 0,
      cachedInputTokens:
        readFiniteNumber(usage.inputTokenDetails?.cacheReadTokens) ??
        readFiniteNumber(usage.cachedInputTokens),
      reasoningTokens:
        readFiniteNumber(usage.outputTokenDetails?.reasoningTokens) ??
        readFiniteNumber(usage.reasoningTokens),
    },
  }
}
