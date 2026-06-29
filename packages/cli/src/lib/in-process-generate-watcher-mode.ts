/**
 * Resolves the watcher-mode env flag that governs whether the dev runtime
 * runs the generate watcher in-process (default) or as a legacy out-of-process
 * `mercato generate watch --skip-initial` sidecar.
 *
 * `OM_DEV_GENERATE_WATCH_MODE=legacy` opts back into the pre-consolidation
 * behavior (one extra long-running Node process). Any other value, missing
 * value, or unparseable value resolves to `in-process`.
 */

export type GenerateWatcherMode = 'in-process' | 'legacy'

export function resolveGenerateWatcherMode(env: NodeJS.ProcessEnv): GenerateWatcherMode {
  const raw = env.OM_DEV_GENERATE_WATCH_MODE
  if (typeof raw !== 'string') return 'in-process'
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'legacy' || normalized === 'sidecar' || normalized === 'out-of-process') {
    return 'legacy'
  }
  return 'in-process'
}
