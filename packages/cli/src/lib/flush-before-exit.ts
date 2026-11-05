import { flushTelemetry } from './flush-telemetry'

export type ExitFlushSteps = {
  flushBroadcasts: () => Promise<void>
  flushTelemetry: () => Promise<void>
}

async function flushPendingBrowserBroadcasts(): Promise<void> {
  const { BROADCAST_FLUSH_DEADLINE_MS, flushPendingBroadcasts } = await import(
    '@open-mercato/events/broadcast-coalescer'
  )
  await flushPendingBroadcasts({ deadlineMs: BROADCAST_FLUSH_DEADLINE_MS })
}

/**
 * Runs before a returning CLI command's explicit `process.exit()`, which Node
 * skips `beforeExit` for — the natural-exit path the broadcast-coalescer
 * shutdown hook relies on to deliver a burst's trailing browser dispatch.
 *
 * The broadcast flush runs FIRST so its final `pg_notify` and the telemetry it
 * produces are still captured by the telemetry flush that follows. It is capped
 * at BROADCAST_FLUSH_DEADLINE_MS (3000ms), so a stalled Postgres connection at
 * exit degrades to a dropped tail instead of hanging the command. Both steps are
 * best-effort: neither can reject, and neither changes the command's exit code.
 *
 * Imported from the `broadcast-coalescer` deep path, and only after `run()` has
 * bootstrapped the app, so it never loads the Postgres driver ahead of
 * `initTelemetry()`.
 */
export async function flushBeforeExit(steps: Partial<ExitFlushSteps> = {}): Promise<void> {
  const flushBroadcasts = steps.flushBroadcasts ?? flushPendingBrowserBroadcasts
  try {
    await flushBroadcasts()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[events] Broadcast flush on exit failed; the last browser refresh may be lost: ${reason}`)
  }
  await (steps.flushTelemetry ?? flushTelemetry)()
}
