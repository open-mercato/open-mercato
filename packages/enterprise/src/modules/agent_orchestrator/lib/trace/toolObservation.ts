import { z } from 'zod'
import type { RunObservationSnapshot } from '@open-mercato/shared/lib/ai/run-observation'
import type { TraceSpanIngest } from '../../data/validators'

export const TOOL_OBSERVATION_SPAN_NAME = 'tool.observation'
export const TOOL_OBSERVATION_MAX_CHARS = 3500
export const TOOL_OBSERVATION_MAX_RETRIEVALS = 10
export const TOOL_OBSERVATION_MAX_HITS_PER_RETRIEVAL = 20
const EXTERNAL_SPAN_ID_MAX_LENGTH = 200
const REF_MAX_LENGTH = 200
const LABEL_MAX_LENGTH = 120
const OPENCODE_MCP_TOOL_PREFIX = 'open-mercato_'

const retrievalHitSchema = z.object({
  ref: z.string(),
  score: z.number().optional(),
  version: z.string().optional(),
})

const retrievalSchema = z.object({
  source: z.string(),
  queryHash: z.string(),
  k: z.number(),
  hits: z.array(retrievalHitSchema),
  hitCount: z.number().optional(),
})

export const toolObservationAttributesSchema = z.object({
  'om.tool.name': z.string().min(1),
  'om.knowledge': z.record(z.string(), z.string()).catch({}),
  'om.retrieval': z.array(retrievalSchema).catch([]),
})

export type ToolObservationRetrieval = z.infer<typeof retrievalSchema>

export type ToolObservationAttributes = {
  'om.tool.name': string
  'om.knowledge': Record<string, string>
  'om.retrieval': ToolObservationRetrieval[]
  'om.observation.dropped'?: { knowledgeKeys: number; retrievalHits: number; retrievals: number }
  'om.observation.truncated'?: true
}

export type ToolObservationRecord = {
  toolName: string
  startedAt: string
  knowledge: Record<string, string>
  retrievals: ToolObservationRetrieval[]
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

export function toolObservationExternalSpanId(runId: string, observationId: string): string {
  return clip(`${runId}:obs:${observationId}`, EXTERNAL_SPAN_ID_MAX_LENGTH)
}

export function hasToolObservationReports(snapshot: RunObservationSnapshot): boolean {
  return Object.keys(snapshot.knowledge).length > 0 || snapshot.retrievals.length > 0
}

function fits(attributes: ToolObservationAttributes): boolean {
  return JSON.stringify(attributes).length <= TOOL_OBSERVATION_MAX_CHARS
}

function shrinkToFit(attributes: ToolObservationAttributes): void {
  const retrievals = attributes['om.retrieval']
  for (let index = retrievals.length - 1; index >= 0 && !fits(attributes); index -= 1) {
    const hits = retrievals[index].hits
    while (hits.length > 0 && !fits(attributes)) hits.pop()
  }
  while (retrievals.length > 0 && !fits(attributes)) retrievals.pop()
  const knowledge = attributes['om.knowledge']
  const keysDescending = Object.keys(knowledge).sort((left, right) => compareCodePoints(right, left))
  for (const key of keysDescending) {
    if (fits(attributes)) break
    delete knowledge[key]
  }
}

/**
 * Projects a run-observation snapshot onto `tool.observation` span attributes:
 * knowledge key → version and retrieval ids/versions/scores only (labels and
 * query text never leave the process), capped to fit the span attribute limit.
 */
export function buildToolObservationAttributes(
  toolName: string,
  snapshot: RunObservationSnapshot,
): ToolObservationAttributes {
  const knowledge: Record<string, string> = {}
  for (const key of Object.keys(snapshot.knowledge).sort(compareCodePoints)) {
    knowledge[key] = clip(snapshot.knowledge[key].version, LABEL_MAX_LENGTH)
  }
  const retrievals = snapshot.retrievals.slice(0, TOOL_OBSERVATION_MAX_RETRIEVALS).map((retrieval) => ({
    source: clip(retrieval.source, LABEL_MAX_LENGTH),
    queryHash: clip(retrieval.queryHash, LABEL_MAX_LENGTH),
    k: retrieval.k,
    hitCount: retrieval.hits.length,
    hits: retrieval.hits.slice(0, TOOL_OBSERVATION_MAX_HITS_PER_RETRIEVAL).map((hit) => ({
      ref: clip(hit.ref, REF_MAX_LENGTH),
      ...(typeof hit.score === 'number' && Number.isFinite(hit.score) ? { score: hit.score } : {}),
      ...(hit.version !== undefined ? { version: clip(hit.version, LABEL_MAX_LENGTH) } : {}),
    })),
  }))
  const attributes: ToolObservationAttributes = {
    'om.tool.name': clip(toolName, LABEL_MAX_LENGTH),
    'om.knowledge': knowledge,
    'om.retrieval': retrievals,
  }
  const droppedRetrievals = snapshot.retrievals.length - retrievals.length
  if (snapshot.dropped.knowledgeKeys > 0 || snapshot.dropped.retrievalHits > 0 || droppedRetrievals > 0) {
    attributes['om.observation.dropped'] = {
      knowledgeKeys: snapshot.dropped.knowledgeKeys,
      retrievalHits: snapshot.dropped.retrievalHits,
      retrievals: droppedRetrievals,
    }
  }
  if (!fits(attributes)) {
    attributes['om.observation.truncated'] = true
    shrinkToFit(attributes)
  }
  return attributes
}

export function parseToolObservationRecord(span: {
  name: string
  startedAt: Date | string
  attributes?: unknown
}): ToolObservationRecord | null {
  if (span.name !== TOOL_OBSERVATION_SPAN_NAME) return null
  const parsed = toolObservationAttributesSchema.safeParse(span.attributes)
  if (!parsed.success) return null
  return {
    toolName: parsed.data['om.tool.name'],
    startedAt: span.startedAt instanceof Date ? span.startedAt.toISOString() : span.startedAt,
    knowledge: parsed.data['om.knowledge'],
    retrievals: parsed.data['om.retrieval'],
  }
}

function sortRecords(records: readonly ToolObservationRecord[]): ToolObservationRecord[] {
  return [...records].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
}

/** Later observations win for the same knowledge key (the version the run last saw). */
export function mergeToolObservationKnowledge(
  records: readonly ToolObservationRecord[],
): Pick<RunObservationSnapshot, 'knowledge'> {
  const knowledge: RunObservationSnapshot['knowledge'] = {}
  for (const record of sortRecords(records)) {
    for (const [key, version] of Object.entries(record.knowledge)) knowledge[key] = { version }
  }
  return { knowledge }
}

export function normalizeObservedToolName(toolName: string): string {
  const bareName = toolName.startsWith(OPENCODE_MCP_TOOL_PREFIX)
    ? toolName.slice(OPENCODE_MCP_TOOL_PREFIX.length)
    : toolName
  return bareName.replace(/\./g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Attributes each observation to a tool span by normalized tool name and call
 * order (the n-th observation of a tool lands on the n-th span of that tool).
 * Observations without a matching span are left alone — they already exist as
 * their own `tool.observation` system spans.
 */
export function foldToolObservationsIntoToolSpans(
  spans: readonly TraceSpanIngest[],
  records: readonly ToolObservationRecord[],
): TraceSpanIngest[] {
  if (records.length === 0) return [...spans]
  const queues = new Map<string, ToolObservationRecord[]>()
  for (const record of sortRecords(records)) {
    const key = normalizeObservedToolName(record.toolName)
    const queue = queues.get(key) ?? []
    queue.push(record)
    queues.set(key, queue)
  }
  return spans.map((span) => {
    if (span.kind !== 'tool') return span
    const record = queues.get(normalizeObservedToolName(span.name))?.shift()
    if (!record) return span
    const baseAttributes = isRecord(span.attributes) ? span.attributes : {}
    return {
      ...span,
      attributes: {
        ...baseAttributes,
        ...(Object.keys(record.knowledge).length > 0 ? { 'om.knowledge': record.knowledge } : {}),
        ...(record.retrievals.length > 0 ? { 'om.retrieval': record.retrievals } : {}),
      },
    }
  })
}
