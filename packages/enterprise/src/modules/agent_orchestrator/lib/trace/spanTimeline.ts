/**
 * Piecewise-linear axis for the trace execution timeline.
 *
 * The timeline used to place every bar as `duration / totalMs` on one linear
 * axis. An agent run is mostly WAITING — a 463s run of eight spans is seven
 * sub-second tool calls, a long pause, and a closing step — so on a linear axis
 * every real span collapses to a hairline at the left edge and the timeline
 * shows nothing. A `Math.max(1.5%, …)` floor kept the bars visible but made
 * every one of them the same width and left the positions bunched, which is
 * worse than useless: it draws a picture that is not the run.
 *
 * The rule is the one `workflows` already settled on for its run Gantt
 * (`lib/run-gantt.ts`): a slice longer than a derived threshold renders at the
 * threshold's width and is reported as compressed. Time stays monotonic and
 * every bar keeps its TRUE `durationMs` — the compression is a rendering
 * decision and must never reach a label.
 *
 * The threshold constants are imported from that module rather than copied, so
 * the two timelines cannot drift apart. The bar SHAPE is local because a trace
 * span and a workflow step instance are different records; only the maths is
 * shared.
 */
import { COLLAPSE_FACTOR, MIN_COLLAPSIBLE_MS } from '@open-mercato/core/modules/workflows/lib/run-gantt'

export type SpanTimelineInput = {
  id: string
  name: string
  startedAt: string | null
  durationMs: number | null
}

export type SpanTimelineBar = {
  id: string
  /** TRUE elapsed time, never the compressed width. */
  durationMs: number | null
  /** Position across the rendered axis, 0..1. */
  offsetRatio: number
  widthRatio: number
}

export type SpanTimelineGap = {
  offsetRatio: number
  widthRatio: number
  /** Wall-clock time hidden by this gap. */
  skippedMs: number
}

export type SpanTimeline = {
  startMs: number
  /** TRUE wall-clock span of the run. */
  totalMs: number
  bars: SpanTimelineBar[]
  gaps: SpanTimelineGap[]
  /** Sum of everything the gaps hide, for the caption. */
  compressedMs: number
  /** Wall-clock instant at a position on the rendered axis, for axis ticks. */
  timeAtRatio: (ratio: number) => number
}

function parseMs(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Slices past this render at the threshold's width. Mirrors run-gantt exactly. */
function resolveThreshold(sliceDurations: readonly number[]): number {
  const positive = sliceDurations.filter((value) => value > 0)
  if (positive.length === 0) return MIN_COLLAPSIBLE_MS
  return Math.max(MIN_COLLAPSIBLE_MS, median(positive) * COLLAPSE_FACTOR)
}

type Slice = { kind: 'span' | 'gap'; startMs: number; lengthMs: number; spanId?: string }

export function buildSpanTimeline(
  spans: readonly SpanTimelineInput[],
  latencyMs: number | null,
): SpanTimeline | null {
  const dated = spans
    .map((span) => ({ span, startMs: parseMs(span.startedAt) }))
    .filter((entry): entry is { span: SpanTimelineInput; startMs: number } => entry.startMs !== null)
    .sort((left, right) => left.startMs - right.startMs)

  if (dated.length === 0) return null

  const startMs = dated[0].startMs
  const lastEnd = dated.reduce(
    (latest, entry) => Math.max(latest, entry.startMs + Math.max(0, entry.span.durationMs ?? 0)),
    startMs,
  )
  const totalMs = Math.max(lastEnd - startMs, latencyMs ?? 0, 1)

  // Cut the run into alternating span and gap slices along wall-clock time.
  const slices: Slice[] = []
  let cursor = startMs
  for (const { span, startMs: spanStart } of dated) {
    if (spanStart > cursor) {
      slices.push({ kind: 'gap', startMs: cursor, lengthMs: spanStart - cursor })
      cursor = spanStart
    }
    const length = Math.max(0, span.durationMs ?? 0)
    slices.push({ kind: 'span', startMs: spanStart, lengthMs: length, spanId: span.id })
    cursor = Math.max(cursor, spanStart + length)
  }
  const tail = startMs + totalMs - cursor
  if (tail > 0) slices.push({ kind: 'gap', startMs: cursor, lengthMs: tail })

  const threshold = resolveThreshold(slices.map((slice) => slice.lengthMs))

  // Weight is what the axis renders; lengthMs is what actually happened.
  const weighted = slices.map((slice) => ({
    ...slice,
    weight: Math.min(slice.lengthMs, threshold),
  }))
  const totalWeight = weighted.reduce((sum, slice) => sum + slice.weight, 0) || 1

  const bars: SpanTimelineBar[] = []
  const gaps: SpanTimelineGap[] = []
  const marks: Array<{ ratio: number; startMs: number; lengthMs: number; weight: number }> = []
  let consumed = 0
  let compressedMs = 0

  for (const slice of weighted) {
    const offsetRatio = consumed / totalWeight
    const widthRatio = slice.weight / totalWeight
    marks.push({ ratio: offsetRatio, startMs: slice.startMs, lengthMs: slice.lengthMs, weight: slice.weight })
    consumed += slice.weight

    if (slice.kind === 'gap') {
      if (slice.lengthMs > slice.weight) {
        compressedMs += slice.lengthMs - slice.weight
        gaps.push({ offsetRatio, widthRatio, skippedMs: slice.lengthMs })
      }
      continue
    }
    const source = dated.find((entry) => entry.span.id === slice.spanId)
    bars.push({
      id: slice.spanId as string,
      durationMs: source?.span.durationMs ?? null,
      offsetRatio,
      widthRatio,
    })
  }

  // Axis ticks must read wall-clock time at a RENDERED position, or the labels
  // would describe a linear axis the bars no longer sit on.
  const timeAtRatio = (ratio: number): number => {
    const clamped = Math.max(0, Math.min(1, ratio))
    const target = clamped * totalWeight
    let walked = 0
    for (const mark of marks) {
      if (walked + mark.weight >= target) {
        const within = mark.weight > 0 ? (target - walked) / mark.weight : 0
        return mark.startMs + within * mark.lengthMs
      }
      walked += mark.weight
    }
    return startMs + totalMs
  }

  return { startMs, totalMs, bars, gaps, compressedMs, timeAtRatio }
}

/**
 * Span rows truncated at the tail, so eight different MCP tool spans all read as
 * the same prefix plus an ellipsis. A tool name's distinguishing part is its
 * SUFFIX, so keep the tail and cut the middle.
 */
export function truncateSpanName(name: string, max = 26): string {
  if (name.length <= max) return name
  const keepTail = Math.ceil((max - 1) * 0.6)
  const keepHead = max - 1 - keepTail
  return `${name.slice(0, keepHead)}…${name.slice(name.length - keepTail)}`
}
