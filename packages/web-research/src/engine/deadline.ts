export const DEADLINE_REACHED = Symbol('web-research/deadline')

export type DeadlineSignal = typeof DEADLINE_REACHED

export type Cancellable<T> = {
  readonly promise: Promise<T>
  cancel(): void
}

/** A race participant that resolves once `ms` elapses and can be torn down. */
export function deadlineRace(ms: number): Cancellable<DeadlineSignal> {
  let cancel = (): void => {}
  const promise = new Promise<DeadlineSignal>((resolve) => {
    const timer = setTimeout(() => resolve(DEADLINE_REACHED), Math.max(0, ms))
    timer.unref?.()
    cancel = () => {
      clearTimeout(timer)
    }
  })
  return { promise, cancel }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    function finish(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Aborts when any input aborts. Node's `AbortSignal.any` exists on modern
 * runtimes but is wrapped here so teardown is explicit and listeners are always
 * removed — an engine run creates one of these per adapter per request.
 */
export function linkSignals(signals: ReadonlyArray<AbortSignal | undefined>): {
  readonly signal: AbortSignal
  dispose(): void
} {
  const controller = new AbortController()
  const active = signals.filter((candidate): candidate is AbortSignal => candidate !== undefined)
  const abort = (): void => {
    controller.abort()
  }
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort()
      break
    }
  }
  if (!controller.signal.aborted) {
    for (const signal of active) signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of active) signal.removeEventListener('abort', abort)
    },
  }
}
