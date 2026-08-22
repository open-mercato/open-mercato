import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  withTelemetrySpan,
  type TelemetrySpan,
  type TelemetrySpanAttributes,
  type TelemetryTraceCarrier,
} from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('data_sync').child({ component: 'batch-stream' })

/** What the handler wants the stream to do next. */
export type BatchOutcome = 'continue' | 'stop'

/** Why the stream ended: the adapter ran out of batches, or a handler stopped it. */
export type BatchStreamResult = 'completed' | 'stopped'

export type BatchStreamOptions = {
  spanName: string
  /**
   * Name for the read that turns out to have drained the stream. That read is
   * real adapter work — it can be a full remote page fetch that comes back
   * empty — so it stays traced, but it is not a batch: leaving it under
   * `spanName` would report one batch more than the run actually processed and
   * feed an unlabelled, counter-less sample into every batch latency panel.
   */
  drainSpanName: string
  /** Run-level attributes repeated on every batch span (run id, entity type, scope). */
  attributes?: TelemetrySpanAttributes
  /** The run's trace, so a rooted batch still points back at what triggered it. */
  linkTo?: TelemetryTraceCarrier
}

/**
 * Close the stream while an error is already in flight. That error is the one
 * worth propagating, so a secondary cleanup failure is logged rather than
 * allowed to mask it — which is what `for await` does on a body throw.
 */
async function closeQuietly(iterator: AsyncIterator<unknown>): Promise<void> {
  if (!iterator.return) return
  try {
    await iterator.return()
  } catch (error) {
    logger.warn('Data sync adapter stream did not close cleanly', { err: error })
  }
}

/**
 * Drive `stream` one batch at a time, running the adapter's read AND `handle`'s
 * bookkeeping for that batch inside a single ROOT span linked back to the run.
 *
 * Rooting per batch is the whole point. A sync run can last days, so leaving its
 * spans nested under the request that triggered it puts the entire run behind
 * one sampling decision — below ratio 1.0 a run can emit nothing at all, and at
 * 1.0 it becomes a single unrenderable trace. A batch is the unit the slowness
 * analysis actually reasons about, so it gets its own trace and its own
 * decision.
 *
 * The iterator is driven explicitly instead of with `for await` so the span can
 * wrap `next()`, which is where an adapter generator does its real work — it
 * reads, transforms and upserts before it ever yields. A stream is only known to
 * be drained once that read returns `done`, so the last span per run starts
 * under `spanName` and is renamed to `drainSpanName`: a run over N batches emits
 * N spans named `spanName` and exactly one named `drainSpanName`.
 *
 * Closing follows the language's own `IteratorClose` rules exactly, so adapter
 * cleanup behaves as it did under `for await`:
 *
 * - **exhausted** — the iterator already completed itself; no `return()` call.
 * - **stopped early** — `return()` is called and a failure to close *is* the
 *   result, the same as breaking out of `for await`.
 * - **`handle` threw** — `return()` is called, but its failure is swallowed so
 *   the handler's error still wins.
 * - **`next()` threw** — the iterator is already closed; no `return()` call.
 */
export async function forEachBatch<TBatch>(
  stream: AsyncIterable<TBatch>,
  options: BatchStreamOptions,
  handle: (batch: TBatch, span: TelemetrySpan) => Promise<BatchOutcome>,
): Promise<BatchStreamResult> {
  const iterator = stream[Symbol.asyncIterator]()
  for (;;) {
    let readThrew = false
    let outcome: BatchOutcome | 'exhausted'
    try {
      outcome = await withTelemetrySpan(
        options.spanName,
        async (span): Promise<BatchOutcome | 'exhausted'> => {
          let next: IteratorResult<TBatch>
          try {
            next = await iterator.next()
          } catch (error) {
            readThrew = true
            throw error
          }
          if (next.done) {
            span.updateName?.(options.drainSpanName)
            return 'exhausted'
          }
          return handle(next.value, span)
        },
        {
          root: true,
          attributes: options.attributes,
          links: options.linkTo ? [options.linkTo] : undefined,
        },
      )
    } catch (error) {
      if (!readThrew) await closeQuietly(iterator)
      throw error
    }
    if (outcome === 'exhausted') return 'completed'
    if (outcome === 'stop') {
      await iterator.return?.()
      return 'stopped'
    }
  }
}
