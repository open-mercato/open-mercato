/**
 * Pure, bounded diff helpers behind `GET /runs/:id/compare`: manifest and
 * request-parameter field diffs, an LCS line diff for the system prompt and a
 * JSON-path diff for messages and tool definitions. Every helper caps its input
 * and marks the result `truncated` instead of growing without bound.
 */

import { GEN_AI_ATTRIBUTES, type LlmSpanMetadata } from './genAiAttributes'
import type { RunManifestView } from './runManifestView'

export type FieldDiff = { key: string; left: unknown; right: unknown }

export type TextDiffOp = 'equal' | 'added' | 'removed'
export type TextDiffLine = { op: TextDiffOp; text: string }
export type TextDiff = { changed: boolean; truncated: boolean; lines: TextDiffLine[] }

export type JsonDiffOp = 'added' | 'removed' | 'changed'
export type JsonDiffEntry = { path: string; op: JsonDiffOp; left?: unknown; right?: unknown }
export type JsonDiff = { changed: boolean; truncated: boolean; entries: JsonDiffEntry[] }

export type TextDiffLimits = { maxLines: number; maxChars: number }
export type JsonDiffLimits = { maxDepth: number; maxEntries: number; maxValueChars: number }

export const TEXT_DIFF_LIMITS: TextDiffLimits = { maxLines: 1000, maxChars: 200_000 }
export const JSON_DIFF_LIMITS: JsonDiffLimits = { maxDepth: 8, maxEntries: 200, maxValueChars: 2000 }

export type ValueTruncationMarker = { _truncated: true; originalChars: number }

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort((first, second) => (first < second ? -1 : first > second ? 1 : 0))
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function compareCodeUnits(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function diffRecords(left: Record<string, unknown>, right: Record<string, unknown>): FieldDiff[] {
  const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort(compareCodeUnits)
  const diffs: FieldDiff[] = []
  for (const key of keys) {
    const leftValue = left[key] ?? null
    const rightValue = right[key] ?? null
    if (!valuesEqual(leftValue, rightValue)) diffs.push({ key, left: leftValue, right: rightValue })
  }
  return diffs
}

/** Changed `run.manifest` fields, keyed by manifest attribute name. A missing side reads as `null`. */
export function diffManifests(left: RunManifestView | null, right: RunManifestView | null): FieldDiff[] {
  return diffRecords({ ...(left ?? {}) }, { ...(right ?? {}) })
}

/** The `gen_ai.request.*` view of an llm span's normalized metadata. */
export function requestParamsRecord(metadata: LlmSpanMetadata | null): Record<string, unknown> {
  if (!metadata) return {}
  const params = metadata.params
  const entries: Array<[string, unknown]> = [
    [GEN_AI_ATTRIBUTES.requestModel, metadata.requestModel],
    [GEN_AI_ATTRIBUTES.requestTemperature, params.temperature],
    [GEN_AI_ATTRIBUTES.requestTopP, params.topP],
    [GEN_AI_ATTRIBUTES.requestTopK, params.topK],
    [GEN_AI_ATTRIBUTES.requestMaxTokens, params.maxTokens],
    [GEN_AI_ATTRIBUTES.requestSeed, params.seed],
    [GEN_AI_ATTRIBUTES.requestStopSequences, params.stopSequences],
    [GEN_AI_ATTRIBUTES.requestPresencePenalty, params.presencePenalty],
    [GEN_AI_ATTRIBUTES.requestFrequencyPenalty, params.frequencyPenalty],
  ]
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined))
}

/** Changed `gen_ai.request.*` parameters between two llm steps. */
export function diffRequestParams(left: LlmSpanMetadata | null, right: LlmSpanMetadata | null): FieldDiff[] {
  return diffRecords(requestParamsRecord(left), requestParamsRecord(right))
}

function boundLines(text: string, limits: TextDiffLimits): { lines: string[]; truncated: boolean } {
  const clipped = text.length > limits.maxChars ? text.slice(0, limits.maxChars) : text
  const lines = clipped.split('\n')
  const truncatedLines = lines.length > limits.maxLines
  return {
    lines: truncatedLines ? lines.slice(0, limits.maxLines) : lines,
    truncated: clipped.length !== text.length || truncatedLines,
  }
}

function lcsLineOps(left: string[], right: string[]): TextDiffLine[] {
  const rows = left.length + 1
  const columns = right.length + 1
  const table = new Uint32Array(rows * columns)
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row * columns + column] =
        left[row] === right[column]
          ? table[(row + 1) * columns + column + 1] + 1
          : Math.max(table[(row + 1) * columns + column], table[row * columns + column + 1])
    }
  }
  const ops: TextDiffLine[] = []
  let row = 0
  let column = 0
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      ops.push({ op: 'equal', text: left[row] })
      row += 1
      column += 1
    } else if (table[(row + 1) * columns + column] >= table[row * columns + column + 1]) {
      ops.push({ op: 'removed', text: left[row] })
      row += 1
    } else {
      ops.push({ op: 'added', text: right[column] })
      column += 1
    }
  }
  for (; row < left.length; row += 1) ops.push({ op: 'removed', text: left[row] })
  for (; column < right.length; column += 1) ops.push({ op: 'added', text: right[column] })
  return ops
}

/**
 * Line diff (longest common subsequence) of two texts. Input is capped at
 * `maxChars` characters and `maxLines` lines per side; the common prefix and
 * suffix are matched before the quadratic LCS table is built.
 */
export function diffTextLines(
  left: string | null,
  right: string | null,
  limits: TextDiffLimits = TEXT_DIFF_LIMITS,
): TextDiff {
  const leftBound = left === null ? { lines: [], truncated: false } : boundLines(left, limits)
  const rightBound = right === null ? { lines: [], truncated: false } : boundLines(right, limits)
  const leftLines = leftBound.lines
  const rightLines = rightBound.lines
  let prefix = 0
  while (prefix < leftLines.length && prefix < rightLines.length && leftLines[prefix] === rightLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < leftLines.length - prefix &&
    suffix < rightLines.length - prefix &&
    leftLines[leftLines.length - 1 - suffix] === rightLines[rightLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const middle = lcsLineOps(
    leftLines.slice(prefix, leftLines.length - suffix),
    rightLines.slice(prefix, rightLines.length - suffix),
  )
  const lines: TextDiffLine[] = [
    ...leftLines.slice(0, prefix).map((text) => ({ op: 'equal' as const, text })),
    ...middle,
    ...leftLines.slice(leftLines.length - suffix).map((text) => ({ op: 'equal' as const, text })),
  ]
  return {
    changed: lines.some((line) => line.op !== 'equal'),
    truncated: leftBound.truncated || rightBound.truncated,
    lines,
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`
  return IDENTIFIER_PATTERN.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A value small enough to return in a diff entry, or a truncation marker. */
export function boundDiffValue(value: unknown, maxChars: number): unknown {
  if (value === undefined) return undefined
  const serialized = stableStringify(value)
  if (serialized.length <= maxChars) return value
  const marker: ValueTruncationMarker = { _truncated: true, originalChars: serialized.length }
  return marker
}

type JsonDiffState = { entries: JsonDiffEntry[]; truncated: boolean; stopped: boolean; limits: JsonDiffLimits }

function pushEntry(state: JsonDiffState, entry: JsonDiffEntry): void {
  if (state.entries.length >= state.limits.maxEntries) {
    state.truncated = true
    state.stopped = true
    return
  }
  state.entries.push({
    path: entry.path,
    op: entry.op,
    ...(entry.left !== undefined ? { left: boundDiffValue(entry.left, state.limits.maxValueChars) } : {}),
    ...(entry.right !== undefined ? { right: boundDiffValue(entry.right, state.limits.maxValueChars) } : {}),
  })
}

function walkJson(left: unknown, right: unknown, path: string, depth: number, state: JsonDiffState): void {
  if (state.stopped) return
  if (valuesEqual(left, right)) return
  if (left === undefined) {
    pushEntry(state, { path, op: 'added', right })
    return
  }
  if (right === undefined) {
    pushEntry(state, { path, op: 'removed', left })
    return
  }
  const bothArrays = Array.isArray(left) && Array.isArray(right)
  const bothRecords = isPlainRecord(left) && isPlainRecord(right)
  if ((!bothArrays && !bothRecords) || depth >= state.limits.maxDepth) {
    if ((bothArrays || bothRecords) && depth >= state.limits.maxDepth) state.truncated = true
    pushEntry(state, { path, op: 'changed', left, right })
    return
  }
  if (bothArrays) {
    const leftItems = left as unknown[]
    const rightItems = right as unknown[]
    const length = Math.max(leftItems.length, rightItems.length)
    for (let index = 0; index < length; index += 1) {
      walkJson(leftItems[index], rightItems[index], childPath(path, index), depth + 1, state)
      if (state.stopped) return
    }
    return
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Array.from(new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])).sort(compareCodeUnits)
  for (const key of keys) {
    walkJson(leftRecord[key], rightRecord[key], childPath(path, key), depth + 1, state)
    if (state.stopped) return
  }
}

/**
 * Structural diff of two JSON values as `$`-rooted paths (arrays aligned by
 * index). Stops descending at `maxDepth` (reporting the subtree as changed),
 * stops after `maxEntries` entries, and replaces values longer than
 * `maxValueChars` serialized characters with a truncation marker.
 */
export function diffJsonPaths(left: unknown, right: unknown, limits: JsonDiffLimits = JSON_DIFF_LIMITS): JsonDiff {
  const state: JsonDiffState = { entries: [], truncated: false, stopped: false, limits }
  walkJson(left ?? null, right ?? null, '$', 0, state)
  return { changed: state.entries.length > 0, truncated: state.truncated, entries: state.entries }
}

export type RequestContentView = { system: string | null; messages: unknown[]; tools: unknown[] }

/** The comparable parts of an `om.llm_request.v1` artifact payload, read defensively. */
export function readRequestContent(payload: unknown): RequestContentView {
  if (!isPlainRecord(payload)) return { system: null, messages: [], tools: [] }
  return {
    system: typeof payload.system === 'string' ? payload.system : null,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    tools: Array.isArray(payload.tools) ? payload.tools : [],
  }
}

export type RequestContentDiff = { systemPrompt: TextDiff; messages: JsonDiff; tools: JsonDiff }

/** System-prompt, messages and tool-definition diffs of two captured requests. */
export function diffRequestContent(leftPayload: unknown, rightPayload: unknown): RequestContentDiff {
  const left = readRequestContent(leftPayload)
  const right = readRequestContent(rightPayload)
  return {
    systemPrompt: diffTextLines(left.system, right.system),
    messages: diffJsonPaths(left.messages, right.messages),
    tools: diffJsonPaths(left.tools, right.tools),
  }
}
