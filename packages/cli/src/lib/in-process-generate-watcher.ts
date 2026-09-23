/**
 * In-process generate watcher.
 *
 * Coalesces filesystem events before comparing the current module structure
 * with the last successfully generated snapshot. A failed generation retries
 * the full suite without waiting for another event. Capturing before generation
 * leaves edits made during a run dirty for the next serial poll.
 *
 * Contract preserved from the prior standalone watcher:
 *   - Default debounce/fallback poll interval 1000 ms (minimum 250 ms).
 *   - One initial generator run unless `skipInitial` is true.
 *   - Concurrent regeneration requests are coalesced (running + pending).
 *   - Generator errors are logged but never crash the watcher.
 *   - The polling timer uses `.unref()` so it never blocks process exit.
 */
import { planGenerateWatchChanges } from './generate-watch-plan'
import type { GenerateWatchPlan, GenerateWatchSnapshot } from './generate-watch-plan'

export type GenerateWatcherLogger = Pick<Console, 'log' | 'error'>

export type GenerateWatcherChangeSignal = {
  /** Monotonic event generation. Changes indicate that a checksum may be stale. */
  currentVersion(): number
  /** Explain events without a usable filename since a captured event version. */
  fullGenerationReasonSince?(version: number): string | undefined
  /** Refresh filesystem subscriptions after module configuration changes. */
  refresh(): Promise<void> | void
  /** Whether configured roots are missing and should be retried on idle polls. */
  hasSkippedTargets?(): boolean
  /** When true, preserve the legacy full-checksum-on-every-poll behavior. */
  usesPollingFallback(): boolean
  /** Close filesystem subscriptions. Idempotent. */
  close(): Promise<void> | void
}

export type GenerateWatcherOptions = {
  /**
   * Function that returns the current structural fingerprint of the module
   * tree. The watcher re-runs `runGenerators` whenever this value changes.
   */
  computeStructureChecksum: () => Promise<string> | string
  /** Optional event signal that avoids full checksum work during idle polls. */
  changeSignal?: GenerateWatcherChangeSignal
  /** Opt in to category-aware planning; legacy checksum-only callers stay valid. */
  incremental?: {
    capture(): Promise<GenerateWatchSnapshot> | GenerateWatchSnapshot
    plan(previous: GenerateWatchSnapshot, next: GenerateWatchSnapshot): GenerateWatchPlan
  }
  /**
   * Function that performs the actual regeneration work. Called once on
   * startup (unless `skipInitial`) and again whenever the checksum changes.
   * The `reason` argument is suitable for logging (`'initial'`,
   * `'structure change'`, `'retry after failed generation'`).
   */
  runGenerators: (reason: string, plan?: GenerateWatchPlan) => Promise<void>
  /** Poll interval in milliseconds. Defaults to 1000. Clamped to >= 250. */
  pollMs?: number
  /** Skip the initial regeneration on startup. Defaults to false. */
  skipInitial?: boolean
  /** Suppress informational logs. Errors are always logged. */
  quiet?: boolean
  /** Logger override. Defaults to `console`. */
  logger?: GenerateWatcherLogger
}

export type GenerateWatcherHandle = {
  /** Resolves when the watcher loop has stopped (after `close()`). */
  readonly done: Promise<void>
  /** Stop the polling loop and resolve `done`. Idempotent. */
  close(): Promise<void>
}

const MIN_POLL_MS = 250
const DEFAULT_POLL_MS = 1000

function resolvePollMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_POLL_MS
  const numeric = Math.floor(value)
  return numeric >= MIN_POLL_MS ? numeric : DEFAULT_POLL_MS
}

/**
 * Start an in-process generate watcher. The returned handle exposes a
 * `close()` to stop polling and a `done` promise that resolves once the
 * watcher loop has finished.
 */
export function startInProcessGenerateWatcher(
  options: GenerateWatcherOptions,
): GenerateWatcherHandle {
  const logger = options.logger ?? console
  const quiet = options.quiet === true
  const pollMs = resolvePollMs(options.pollMs)
  const { changeSignal, computeStructureChecksum, runGenerators, incremental } = options
  let stopping = false
  let pollTimer: NodeJS.Timeout | null = null
  let previousChecksum: string | undefined
  let previousSnapshot: GenerateWatchSnapshot | undefined
  let observedChangeVersion = -1
  let retryReason: string | undefined
  let doneResolve: () => void = () => {}
  const done = new Promise<void>((resolve) => { doneResolve = resolve })

  async function captureAndGenerate(initial: boolean, refreshSubscriptions = true): Promise<void> {
    // This version belongs to the candidate, not to the state after generation.
    const changeVersion = changeSignal?.currentVersion() ?? 0
    const candidate = incremental ? await incremental.capture() : undefined
    const checksum = candidate?.checksum ?? await computeStructureChecksum()
    if (stopping) return
    if (refreshSubscriptions) await changeSignal?.refresh()
    if (stopping) return

    const skipInitial = initial && options.skipInitial === true
    const changed = checksum !== previousChecksum
    const uncertain = Boolean(candidate?.fullReasons.length)
    const eventReason = changeSignal?.fullGenerationReasonSince?.(observedChangeVersion)
    const shouldGenerate = !skipInitial && (initial || retryReason || changed || uncertain || eventReason)
    if (shouldGenerate) {
      let plan: GenerateWatchPlan | undefined
      if (incremental && candidate) {
        const fallbackReason = initial
          ? 'initial generation'
          : retryReason
            ?? (!previousSnapshot
              ? 'no successful snapshot'
              : changeSignal?.usesPollingFallback()
                ? 'filesystem watching unavailable; polling fallback'
                : eventReason)
        const candidatePlan = previousSnapshot ? incremental.plan(previousSnapshot, candidate) : undefined
        plan = fallbackReason
          ? planGenerateWatchChanges(candidatePlan?.changes ?? [], [fallbackReason, ...candidate.fullReasons])
          : candidatePlan
      }
      if (plan?.mode !== 'none') {
        const reason = initial ? 'initial' : retryReason ?? 'structure change'
        if (!quiet) {
          const detail = plan
            ? `; categories=${[...new Set(plan.changes.map((change) => change.category))].join(',') || 'all'}; groups=${plan.groups.join(',')}${plan.reasons.length ? `; reasons=${plan.reasons.join('; ')}` : ''}`
            : ''
          logger.log(`[generate:watch] Regenerating (${reason}${detail})...`)
        }
        try {
          // Do not add an undefined argument to the legacy callback contract.
          if (plan) await runGenerators(reason, plan)
          else await runGenerators(reason)
        } catch (error) {
          retryReason = 'retry after failed generation'
          const message = error instanceof Error ? error.message : String(error)
          logger.error(`[generate:watch] Generation failed: ${message}`)
          return
        }
        // A successful bundle can discover new external dependencies to watch.
        if (incremental && !stopping) await changeSignal?.refresh()
        if (!quiet) logger.log('[generate:watch] Generators completed.')
      }
    }
    // Only successful generation (or a verified no-op) acknowledges this input.
    if (uncertain) {
      retryReason = 'retry after uncertain structure snapshot'
      return
    }
    previousChecksum = checksum
    previousSnapshot = candidate
    observedChangeVersion = changeVersion
    retryReason = undefined
  }

  async function poll(): Promise<void> {
    try {
      if (stopping) return
      const eventGatedIdle = !retryReason
        && previousChecksum !== undefined
        && changeSignal
        && !changeSignal.usesPollingFallback()
        && changeSignal.currentVersion() === observedChangeVersion
      if (eventGatedIdle) {
        if (!changeSignal.hasSkippedTargets?.()) return
        await changeSignal.refresh()
        if (stopping) return
        // New roots may appear while other optional roots remain absent.
        if (changeSignal.currentVersion() === observedChangeVersion
          && changeSignal.hasSkippedTargets?.()) return
      }
      await captureAndGenerate(false, !eventGatedIdle)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[generate:watch] Poll cycle failed: ${message}`)
    } finally {
      scheduleNext()
    }
  }

  function scheduleNext(): void {
    if (stopping) return
    pollTimer = setTimeout(() => {
      pollTimer = null
      activeCycle = poll()
    }, pollMs)
    pollTimer.unref?.()
  }

  let activeCycle = (async () => {
    try {
      await changeSignal?.refresh()
      if (stopping) return
      await captureAndGenerate(true, Boolean(incremental))
      if (!quiet && !stopping) {
        if (options.skipInitial) {
          logger.log('[generate:watch] Skipping initial regeneration and watching the current generated state.')
        }
        logger.log(`[generate:watch] Watching structural module files with a ${pollMs}ms debounce (in-process).`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[generate:watch] Initial setup failed: ${message}`)
    } finally {
      scheduleNext()
    }
  })()

  async function close(): Promise<void> {
    if (stopping) return done
    stopping = true
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    try {
      await changeSignal?.close()
    } finally {
      // Let any active suite finish before a replacement watcher can start.
      await activeCycle
      doneResolve()
    }
  }

  return { done, close }
}
