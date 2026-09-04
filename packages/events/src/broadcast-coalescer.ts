import { parseNumberWithDefault } from '@open-mercato/shared/lib/number'
import { createLogger } from '@open-mercato/shared/lib/logger'

/**
 * Coalesces the BROWSER half of an event emit.
 *
 * A `clientBroadcast: true` event costs a serialized `pg_notify` roundtrip plus a
 * tenant-wide SSE fan-out on every emit, so a bulk writer pays both once per
 * record even though its browser consumers only refresh a list. Events that opt
 * in with `broadcastCoalescing: true` route their browser dispatch through here:
 * the first emit of a burst goes out immediately (leading edge) and later emits
 * sharing a key replace the pending payload instead of being delivered.
 *
 * A trailing flush is ALWAYS armed, so the last emit of a burst is delivered and
 * a DataTable never ends the burst stale. This is where the mechanism goes past
 * the progress service's private throttle, which can drop its tail only because
 * its terminal transitions emit through a separate unthrottled path.
 *
 * Inline subscribers, webhooks and the queue never reach this module — the domain
 * event still fires once per record.
 */

const DEFAULT_COALESCE_INTERVAL_MS = 250
const PENDING_BROADCASTS_KEY = '__openMercatoPendingBroadcasts__'

const logger = createLogger('events').child({ component: 'broadcast-coalescer' })

type BroadcastDispatch = () => Promise<void>

type PendingBroadcast = {
  /** The newest superseding dispatch awaiting the trailing flush, if any. */
  pending: BroadcastDispatch | null
  timer: ReturnType<typeof setTimeout> | null
  suppressed: number
}

/**
 * Held on `globalThis` for the same reason as the bus's global taps and producer
 * queue: a fresh event bus is built per request, so per-bus state would coalesce
 * nothing across the emits of a single bulk job.
 */
function getPendingBroadcasts(): Map<string, PendingBroadcast> {
  const existing = (globalThis as Record<string, unknown>)[PENDING_BROADCASTS_KEY]
  if (existing instanceof Map) {
    return existing as Map<string, PendingBroadcast>
  }
  const created = new Map<string, PendingBroadcast>()
  ;(globalThis as Record<string, unknown>)[PENDING_BROADCASTS_KEY] = created
  return created
}

/**
 * Minimum elapsed time between coalesced browser deliveries of one key. `0`
 * disables coalescing process-wide, restoring per-record delivery — the runtime
 * escape hatch, mirroring `OM_PROGRESS_BROADCAST_MIN_INTERVAL_MS=0`.
 */
export function resolveBroadcastCoalesceIntervalMs(): number {
  return parseNumberWithDefault(
    process.env.OM_BROADCAST_COALESCE_INTERVAL_MS,
    DEFAULT_COALESCE_INTERVAL_MS,
    { min: 0, integer: true },
  )
}

function armTimer(key: string, intervalMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    void onWindowClosed(key, intervalMs)
  }, intervalMs)
  // Never keep a CLI or worker process alive just to flush a browser delivery.
  // The shutdown hook flushes what is still pending on the way out.
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    ;(timer as { unref: () => void }).unref()
  }
  return timer
}

async function onWindowClosed(key: string, intervalMs: number): Promise<void> {
  const entries = getPendingBroadcasts()
  const entry = entries.get(key)
  if (!entry) return

  const pending = entry.pending
  if (!pending) {
    // The window closed with nothing superseded: the burst is over.
    entry.timer = null
    entries.delete(key)
    return
  }

  const suppressed = entry.suppressed
  entry.pending = null
  entry.suppressed = 0
  // Re-arm before dispatching so a burst still in flight keeps its window.
  entry.timer = armTimer(key, intervalMs)

  await runDispatch(pending, key)
  if (suppressed > 0) {
    logger.debug('Coalesced browser deliveries', { key, suppressed })
  }
}

/**
 * A deferred dispatch has no caller awaiting it, so its failure must be
 * contained here — `bus.emit` already logs-and-continues on a synchronous
 * publish failure, and one failed flush must not stop the next window.
 */
async function runDispatch(dispatch: BroadcastDispatch, key: string): Promise<void> {
  try {
    await dispatch()
  } catch (error) {
    logger.error('Coalesced broadcast dispatch failed', { key, err: error })
  }
}

/**
 * Submit a browser dispatch for `key`. Resolves once the caller's obligation is
 * discharged: immediately-dispatched submissions resolve after delivery,
 * superseded ones resolve as soon as they are queued.
 */
export async function submitBroadcast(
  key: string,
  dispatch: BroadcastDispatch,
  options?: { intervalMs?: number },
): Promise<void> {
  const intervalMs = options?.intervalMs ?? resolveBroadcastCoalesceIntervalMs()
  if (intervalMs <= 0) {
    await dispatch()
    return
  }

  const entries = getPendingBroadcasts()
  const entry = entries.get(key)
  if (!entry) {
    entries.set(key, { pending: null, timer: armTimer(key, intervalMs), suppressed: 0 })
    await dispatch()
    return
  }

  if (entry.pending) entry.suppressed += 1
  entry.pending = dispatch
}

/**
 * Deliver every survivor still awaiting its trailing flush. Wired into the
 * process shutdown hook so a graceful stop does not swallow the tail of a burst.
 */
export async function flushPendingBroadcasts(): Promise<void> {
  const entries = getPendingBroadcasts()
  const drained: Array<Promise<void>> = []
  for (const [key, entry] of entries) {
    if (entry.timer) clearTimeout(entry.timer)
    const pending = entry.pending
    entries.delete(key)
    if (pending) drained.push(runDispatch(pending, key))
  }
  await Promise.all(drained)
}

/** Drop all pending state without dispatching. Tests only. */
export function resetBroadcastCoalescerForTests(): void {
  const entries = getPendingBroadcasts()
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer)
  }
  entries.clear()
}
