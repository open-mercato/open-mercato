/**
 * The trace timeline used one linear axis, so a run that is mostly WAITING drew
 * every real span as a sub-pixel dot at the left edge. A `Math.max(1.5%, …)`
 * floor made the bars visible but gave them all the same width — a picture that
 * is not the run.
 *
 * The contract these tests pin: geometry may be compressed, TIME MAY NOT LIE.
 * Order stays monotonic, `durationMs` stays true, and anything hidden is
 * reported in `compressedMs` so the UI can say so.
 */
import { buildSpanTimeline } from '../lib/trace/spanTimeline'

const T0 = Date.parse('2026-08-10T10:00:00.000Z')
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

describe('buildSpanTimeline', () => {
  it('returns null when no span carries a start time', () => {
    expect(buildSpanTimeline([{ id: 'a', name: 'a', startedAt: null, durationMs: 10 }], 100)).toBeNull()
    expect(buildSpanTimeline([], 100)).toBeNull()
  })

  it('keeps the true duration on every bar even where the axis compresses', () => {
    const timeline = buildSpanTimeline(
      [
        { id: 'fast', name: 'fast', startedAt: at(0), durationMs: 40 },
        { id: 'slow', name: 'slow', startedAt: at(400_000), durationMs: 200 },
      ],
      460_000,
    )
    expect(timeline).not.toBeNull()
    expect(timeline!.bars.map((bar) => bar.durationMs)).toEqual([40, 200])
    // Wall clock is the real one, not the sum of the rendered widths.
    expect(timeline!.totalMs).toBeGreaterThanOrEqual(400_200)
  })

  it('gives short spans real width on a run dominated by one long wait', () => {
    // The reported case: seven sub-second calls, then a 400s gap.
    const spans = Array.from({ length: 7 }, (_, index) => ({
      id: `call-${index}`,
      name: `tool-${index}`,
      startedAt: at(index * 300),
      durationMs: 120,
    }))
    spans.push({ id: 'last', name: 'closing', startedAt: at(420_000), durationMs: 900 })

    const timeline = buildSpanTimeline(spans, 460_000)!
    const linearShare = 120 / 460_000

    for (const bar of timeline.bars.slice(0, 7)) {
      expect(bar.widthRatio).toBeGreaterThan(linearShare * 50)
      expect(bar.widthRatio).toBeLessThan(1)
    }
    // Positions must still separate; a floor-based fix bunched them all at 0.
    const offsets = timeline.bars.map((bar) => bar.offsetRatio)
    expect(new Set(offsets).size).toBe(offsets.length)
  })

  it('reports the hidden wall-clock time so the UI can disclose it', () => {
    const timeline = buildSpanTimeline(
      [
        { id: 'a', name: 'a', startedAt: at(0), durationMs: 100 },
        { id: 'b', name: 'b', startedAt: at(300_000), durationMs: 100 },
      ],
      300_100,
    )!
    expect(timeline.compressedMs).toBeGreaterThan(0)
    expect(timeline.gaps.length).toBeGreaterThan(0)
    expect(timeline.gaps.reduce((sum, gap) => sum + gap.skippedMs, 0)).toBeGreaterThanOrEqual(
      timeline.compressedMs,
    )
  })

  it('does not compress a run whose spans are evenly spread', () => {
    const timeline = buildSpanTimeline(
      Array.from({ length: 4 }, (_, index) => ({
        id: `s${index}`,
        name: `s${index}`,
        startedAt: at(index * 1000),
        durationMs: 1000,
      })),
      4000,
    )!
    expect(timeline.compressedMs).toBe(0)
    expect(timeline.gaps).toEqual([])
  })

  it('orders bars monotonically and keeps every offset inside the axis', () => {
    const timeline = buildSpanTimeline(
      [
        { id: 'third', name: 'third', startedAt: at(90_000), durationMs: 50 },
        { id: 'first', name: 'first', startedAt: at(0), durationMs: 50 },
        { id: 'second', name: 'second', startedAt: at(120), durationMs: 50 },
      ],
      95_000,
    )!
    expect(timeline.bars.map((bar) => bar.id)).toEqual(['first', 'second', 'third'])
    let previous = -1
    for (const bar of timeline.bars) {
      expect(bar.offsetRatio).toBeGreaterThanOrEqual(previous)
      expect(bar.offsetRatio + bar.widthRatio).toBeLessThanOrEqual(1.0001)
      previous = bar.offsetRatio
    }
  })

  it('reads wall-clock time at a rendered position, monotonically', () => {
    const timeline = buildSpanTimeline(
      [
        { id: 'a', name: 'a', startedAt: at(0), durationMs: 100 },
        { id: 'b', name: 'b', startedAt: at(300_000), durationMs: 100 },
      ],
      300_100,
    )!
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => timeline.timeAtRatio(ratio))
    expect(ticks[0]).toBe(timeline.startMs)
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index]).toBeGreaterThanOrEqual(ticks[index - 1])
    }
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(timeline.startMs + timeline.totalMs + 1)
  })

  it('survives spans with no duration', () => {
    const timeline = buildSpanTimeline(
      [
        { id: 'a', name: 'a', startedAt: at(0), durationMs: null },
        { id: 'b', name: 'b', startedAt: at(500), durationMs: 100 },
      ],
      600,
    )!
    expect(timeline.bars).toHaveLength(2)
    expect(timeline.bars[0].durationMs).toBeNull()
    expect(Number.isFinite(timeline.bars[0].widthRatio)).toBe(true)
  })
})
