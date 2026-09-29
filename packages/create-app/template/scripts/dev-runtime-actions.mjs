import { RUNTIME_RECOVERY_ACTIONS } from './dev-runtime-state.mjs'

export const DEFAULT_ACTION_TIMEOUT_MS = 10 * 60 * 1000
export const MAX_ACTION_OUTPUT_LINES = 40

function conflict(code, message, status = 409) {
  return { ok: false, status, code, message }
}

/**
 * Runs the fixed recovery allowlist against handlers the supervisor already
 * owns. User input selects an enum member and nothing else: it can never name a
 * binary, append a flag, or change a working directory.
 *
 * Exactly one mutating action may run per generation, and a completion from an
 * older generation can never overwrite the current state.
 */
export function createDevRuntimeActionRunner(options = {}) {
  const handlers = options.handlers ?? {}
  const state = options.state
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_ACTION_TIMEOUT_MS
  const logger = options.logger ?? console

  let sequence = 0
  let active = null

  function describeActive() {
    return active ? { ...active } : null
  }

  async function run(action) {
    if (!RUNTIME_RECOVERY_ACTIONS.includes(action)) {
      return { ok: false, status: 400, code: 'unknown_action', message: 'Unknown recovery action.' }
    }
    if (!state) {
      return conflict('supervisor_unavailable', 'The supervisor is no longer available.', 503)
    }
    const handler = handlers[action]
    if (typeof handler !== 'function') {
      return conflict('action_unsupported', `The "${action}" action is not available in this runtime mode.`, 503)
    }
    if (active) {
      return conflict('action_busy', `The "${active.action}" action is still running.`)
    }

    const generation = state.getGeneration()
    sequence += 1
    const actionId = `${generation}-${sequence}`
    active = { actionId, action, generation, startedAt: now().toISOString() }
    state.beginRecovery(action)

    // The await chain is intentionally detached: the caller gets a 202 while the
    // action keeps running under the supervisor's lifecycle.
    void (async () => {
      let exitCode = 1
      try {
        exitCode = await withTimeout(handler(), timeoutMs)
      } catch (error) {
        logger?.error?.(`❌ Dev runtime action "${action}" failed: ${error instanceof Error ? error.message : String(error)}`)
        state.recordSignal({
          source: 'process',
          generation,
          code: 'recovery_action_failed',
          title: 'Recovery action failed',
          detail: `The "${action}" action did not complete successfully`,
          message: error instanceof Error ? error.message : String(error),
          failureStage: `Recovery: ${action}`,
        })
      } finally {
        active = null
        // A stale completion must not clear a recovery that a newer generation
        // started.
        state.completeRecovery(Number.isInteger(exitCode) ? exitCode : 1, { generation })
      }
    })()

    return { ok: true, actionId, generation }
  }

  return { run, describeActive, isBusy: () => active !== null }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`recovery action timed out after ${timeoutMs}ms`)), timeoutMs)
    timer.unref?.()
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
