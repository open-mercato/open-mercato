/**
 * Token usage reported by OpenCode on its SSE stream. Every assistant message
 * carries `info.tokens = { input, output, reasoning, cache: { read, write } }` on
 * `message.updated`, re-emitted as the message grows; the last emission per
 * message id holds the final counts.
 *
 * OpenCode's `input` EXCLUDES prompt-cache reads and writes, while
 * `AgentRun.inputTokens` stores the whole input with the cached read share
 * carried separately as a SUBSET (`cachedInputTokens`). So the run's input is
 * `input + cache.read + cache.write`, and `cachedInputTokens` is `cache.read`.
 */

export type OpenCodeMessageUsage = {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  modelId: string | null
}

/** Latest usage per assistant message id — keying by id makes repeated updates idempotent. */
export type OpenCodeUsageSink = Map<string, OpenCodeMessageUsage>

function toTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function readOpenCodeMessageUsage(info: unknown): { messageId: string; usage: OpenCodeMessageUsage } | null {
  if (!info || typeof info !== 'object') return null
  const record = info as {
    id?: unknown
    role?: unknown
    modelID?: unknown
    tokens?: { input?: unknown; output?: unknown; cache?: { read?: unknown; write?: unknown } }
  }
  if (record.role !== 'assistant' || typeof record.id !== 'string' || !record.tokens) return null
  const cachedInputTokens = toTokenCount(record.tokens.cache?.read)
  const cacheWriteTokens = toTokenCount(record.tokens.cache?.write)
  return {
    messageId: record.id,
    usage: {
      inputTokens: toTokenCount(record.tokens.input) + cachedInputTokens + cacheWriteTokens,
      outputTokens: toTokenCount(record.tokens.output),
      cachedInputTokens,
      modelId: typeof record.modelID === 'string' && record.modelID.trim() !== '' ? record.modelID : null,
    },
  }
}

export function recordOpenCodeMessageUsage(sink: OpenCodeUsageSink, info: unknown): void {
  const measured = readOpenCodeMessageUsage(info)
  if (measured) sink.set(measured.messageId, measured.usage)
}

/** Run totals across messages; null when nothing was measured (usage stays unknown). */
export function totalOpenCodeUsage(sink: OpenCodeUsageSink): OpenCodeMessageUsage | null {
  if (sink.size === 0) return null
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let modelId: string | null = null
  for (const usage of sink.values()) {
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    cachedInputTokens += usage.cachedInputTokens
    if (usage.modelId) modelId = usage.modelId
  }
  if (inputTokens === 0 && outputTokens === 0) return null
  return { inputTokens, outputTokens, cachedInputTokens, modelId }
}
