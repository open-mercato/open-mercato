import { z } from 'zod'
import { findRunManifestView, type RunManifestView } from '../../lib/trace/runManifestView'
import { readLlmSpanMetadata } from '../../lib/trace/genAiAttributes'
import type { RunView, SpanView } from '../types'
import type { LlmContentFetchState, LlmContentKind } from './llmStepContent'

export const RUN_COPY_SCHEMA = 'om.agent_run_trace.v1'
export const COMPARE_CANDIDATE_PAGE_SIZE = 25
export const CONTENT_FETCH_CONCURRENCY = 4

const contentSideStatusSchema = z.enum(['ok', 'expired', 'unavailable', 'not_captured', 'forbidden'])
export type CompareContentStatus = z.infer<typeof contentSideStatusSchema>

const fieldDiffSchema = z.object({ key: z.string(), left: z.unknown(), right: z.unknown() })
const textDiffSchema = z.object({
  changed: z.boolean(),
  truncated: z.boolean(),
  lines: z.array(z.object({ op: z.enum(['equal', 'added', 'removed']), text: z.string() })),
})
const jsonDiffSchema = z.object({
  changed: z.boolean(),
  truncated: z.boolean(),
  entries: z.array(
    z.object({
      path: z.string(),
      op: z.enum(['added', 'removed', 'changed']),
      left: z.unknown().optional(),
      right: z.unknown().optional(),
    }),
  ),
})
const compareSideSchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  status: z.string(),
  model: z.string().nullable(),
  runtime: z.string().nullable(),
  step: z.number(),
  llmStepCount: z.number(),
  spanId: z.string().nullable(),
  spanName: z.string().nullable(),
  contentStatus: contentSideStatusSchema,
})

export const runCompareResultSchema = z.object({
  step: z.number(),
  content: z.enum(['included', 'forbidden']),
  left: compareSideSchema,
  right: compareSideSchema,
  diff: z.object({
    manifest: z.array(fieldDiffSchema),
    params: z.array(fieldDiffSchema),
    systemPrompt: textDiffSchema.optional(),
    messages: jsonDiffSchema.optional(),
    tools: jsonDiffSchema.optional(),
  }),
})

export type RunCompareResult = z.infer<typeof runCompareResultSchema>
export type RunCompareSide = z.infer<typeof compareSideSchema>
export type CompareFieldDiff = z.infer<typeof fieldDiffSchema>
export type CompareTextDiff = z.infer<typeof textDiffSchema>
export type CompareJsonDiff = z.infer<typeof jsonDiffSchema>

export function parseRunCompareResult(payload: unknown): RunCompareResult | null {
  const parsed = runCompareResultSchema.safeParse(payload)
  return parsed.success ? parsed.data : null
}

export type CompareCandidate = { id: string; createdAt: string | null; status: string | null; label: string }

export type CompareSubject = Pick<RunView, 'id' | 'agentId' | 'createdAt' | 'rerunOfRunId'>

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildCompareCandidatesUrl(subject: CompareSubject): string {
  const params = new URLSearchParams({
    agentId: subject.agentId,
    sortField: 'createdAt',
    sortDir: 'desc',
    pageSize: String(COMPARE_CANDIDATE_PAGE_SIZE),
  })
  if (subject.createdAt) params.set('createdBefore', subject.createdAt)
  return `/api/agent_orchestrator/runs?${params.toString()}`
}

export function buildCompareUrl(runId: string, otherRunId: string, step: number): string {
  const params = new URLSearchParams({ with: otherRunId, step: String(step) })
  return `/api/agent_orchestrator/runs/${encodeURIComponent(runId)}/compare?${params.toString()}`
}

export function candidateLabel(run: Pick<RunView, 'id' | 'externalRunId'>): string {
  return run.externalRunId ?? `RUN-${run.id.slice(0, 8)}`
}

export function previousRunCandidates(subject: CompareSubject, runs: readonly RunView[]): CompareCandidate[] {
  const subjectTime = timeOf(subject.createdAt)
  return runs
    .filter((run) => run.id !== subject.id && run.agentId === subject.agentId)
    .filter((run) => {
      if (subjectTime === null) return true
      const runTime = timeOf(run.createdAt)
      return runTime !== null && runTime < subjectTime
    })
    .sort((first, second) => (timeOf(second.createdAt) ?? 0) - (timeOf(first.createdAt) ?? 0))
    .map((run) => ({ id: run.id, createdAt: run.createdAt, status: run.status, label: candidateLabel(run) }))
}

export function pickDefaultCompareTarget(
  subject: CompareSubject,
  candidates: readonly CompareCandidate[],
): string | null {
  if (subject.rerunOfRunId && subject.rerunOfRunId !== subject.id) return subject.rerunOfRunId
  return candidates[0]?.id ?? null
}

export function countLlmSteps(spans: readonly SpanView[]): number {
  return spans.filter((span) => span.kind === 'llm').length
}

export type RunMetadataCopy = {
  schema: typeof RUN_COPY_SCHEMA
  run: RunView
  manifest: RunManifestView | null
  spans: SpanView[]
}

export type CopiedContentSide = { status: LlmContentFetchState['status'] | 'not_captured'; payload?: unknown }

export type CopiedLlmContent = {
  spanId: string
  step: number
  request: CopiedContentSide
  response: CopiedContentSide
}

export type RunContentCopy = RunMetadataCopy & { content: CopiedLlmContent[] }

export function buildRunMetadataCopy(run: RunView, spans: readonly SpanView[]): RunMetadataCopy {
  return { schema: RUN_COPY_SCHEMA, run, manifest: findRunManifestView(spans), spans: [...spans] }
}

export type LlmContentKeys = { spanId: string; step: number; request: string | null; response: string | null }

export function listLlmContentKeys(spans: readonly SpanView[]): LlmContentKeys[] {
  return spans
    .filter((span) => span.kind === 'llm')
    .sort((first, second) => first.sequence - second.sequence)
    .map((span, index) => {
      const metadata = readLlmSpanMetadata(span.attributes)
      return {
        spanId: span.id,
        step: index + 1,
        request: metadata.contentRequestKey ?? null,
        response: metadata.contentResponseKey ?? null,
      }
    })
}

export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  limit: number,
  worker: (item: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(items.length)
  let nextIndex = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex
      nextIndex += 1
      results[current] = await worker(items[current])
    }
  })
  await Promise.all(runners)
  return results
}

export type ArtifactFetcher = (kind: LlmContentKind, key: string) => Promise<LlmContentFetchState>

function toCopiedSide(state: LlmContentFetchState): CopiedContentSide {
  return state.status === 'ok' ? { status: 'ok', payload: state.payload } : { status: state.status }
}

async function readSide(fetcher: ArtifactFetcher, kind: LlmContentKind, key: string | null): Promise<CopiedContentSide> {
  if (!key) return { status: 'not_captured' }
  try {
    return toCopiedSide(await fetcher(kind, key))
  } catch {
    return { status: 'error' }
  }
}

export async function collectRunContent(
  spans: readonly SpanView[],
  fetcher: ArtifactFetcher,
  concurrency: number = CONTENT_FETCH_CONCURRENCY,
): Promise<CopiedLlmContent[]> {
  const keys = listLlmContentKeys(spans)
  const tasks = keys.flatMap((entry) => [
    { entry, kind: 'llm_request' as const, key: entry.request },
    { entry, kind: 'llm_response' as const, key: entry.response },
  ])
  const sides = await mapWithConcurrency(tasks, concurrency, (task) => readSide(fetcher, task.kind, task.key))
  return keys.map((entry, index) => ({
    spanId: entry.spanId,
    step: entry.step,
    request: sides[index * 2],
    response: sides[index * 2 + 1],
  }))
}

export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
