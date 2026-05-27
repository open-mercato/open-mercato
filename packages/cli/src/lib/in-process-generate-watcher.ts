/**
 * In-process generate watcher.
 *
 * Polls a structural-fingerprint function on a configurable interval and
 * invokes the supplied generator callback whenever the fingerprint changes.
 * The polling loop is identical to the legacy standalone watcher; the only
 * difference is that it now runs inside whatever process calls it
 * (typically `mercato server dev`), so the dev runtime no longer needs a
 * sidecar `mercato generate watch` Node process.
 *
 * Contract preserved 1:1 with the prior standalone watcher:
 *   - Default poll interval 1000 ms (minimum 250 ms).
 *   - One initial generator run unless `skipInitial` is true.
 *   - Concurrent regeneration requests are coalesced (running + pending).
 *   - Generator errors are logged but never crash the watcher.
 *   - The polling timer uses `.unref()` so it never blocks process exit.
 */

export type GenerateWatcherLogger = Pick<Console, 'log' | 'error'>

export type GenerateWatcherOptions = {
  /**
   * Function that returns the current structural fingerprint of the module
   * tree. The watcher re-runs `runGenerators` whenever this value changes.
   */
  computeStructureChecksum: () => Promise<string> | string
  /**
   * Function that performs the actual regeneration work. Called once on
   * startup (unless `skipInitial`) and again whenever the checksum changes.
   * The `reason` argument is suitable for logging (`'initial'`,
   * `'structure change'`, `'queued change'`).
   */
  runGenerators: (reason: string) => Promise<void>
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
  const skipInitial = options.skipInitial === true
  const { computeStructureChecksum, runGenerators } = options

  let stopping = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pendingReason: string | null = null
  let previousChecksum = ''
  let doneResolve: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    doneResolve = resolve
  })

  async function runOnce(reason: string): Promise<void> {
    if (running) {
      pendingReason = reason
      return
    }
    running = true
    try {
      if (!quiet) {
        logger.log(`[generate:watch] Regenerating (${reason})...`)
      }
      await runGenerators(reason)
      if (!quiet) {
        logger.log('[generate:watch] Generators completed.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[generate:watch] Generation failed: ${message}`)
    } finally {
      running = false
      if (pendingReason && !stopping) {
        const queued = pendingReason
        pendingReason = null
        await runOnce(queued)
      }
    }
  }

  function scheduleNext(): void {
    if (stopping) return
    pollTimer = setTimeout(() => {
      void (async () => {
        if (stopping) return
        try {
          const nextChecksum = await computeStructureChecksum()
          if (nextChecksum !== previousChecksum) {
            previousChecksum = nextChecksum
            await runOnce('structure change')
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.error(`[generate:watch] Poll cycle failed: ${message}`)
        } finally {
          if (!stopping) scheduleNext()
        }
      })()
    }, pollMs)
    pollTimer.unref?.()
  }

  void (async () => {
    try {
      if (!skipInitial) {
        await runOnce('initial')
      }
      previousChecksum = await computeStructureChecksum()
      if (!quiet) {
        if (skipInitial) {
          logger.log('[generate:watch] Skipping initial regeneration and watching the current generated state.')
        }
        logger.log(`[generate:watch] Watching structural module files every ${pollMs}ms (in-process).`)
      }
      scheduleNext()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[generate:watch] Initial setup failed: ${message}`)
      // Even if the initial bootstrap fails, schedule polling so a later
      // checksum recovery still picks up the next change on disk.
      scheduleNext()
    }
  })()

  async function close(): Promise<void> {
    if (stopping) {
      await done
      return
    }
    stopping = true
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    if (doneResolve) {
      doneResolve()
      doneResolve = null
    }
  }

  return {
    done,
    close,
  }
}
