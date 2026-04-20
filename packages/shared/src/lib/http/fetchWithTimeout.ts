export class FetchTimeoutError extends Error {
  readonly timeoutMs: number
  readonly url: string
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
    this.timeoutMs = timeoutMs
    this.url = url
  }
}

export type FetchWithTimeoutInit = RequestInit & {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export function resolveTimeoutMs(value: number | undefined, fallback: number = DEFAULT_TIMEOUT_MS): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs, signal, ...rest } = init
  const effectiveTimeout = resolveTimeoutMs(timeoutMs)
  const controller = new AbortController()
  const urlForError = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort(new FetchTimeoutError(urlForError, effectiveTimeout))
  }, effectiveTimeout)

  const onExternalAbort = () => {
    controller.abort((signal as AbortSignal | undefined)?.reason)
  }

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      const reason = (controller.signal as AbortSignal & { reason?: unknown }).reason
      if (reason instanceof FetchTimeoutError) throw reason
      if (reason instanceof Error) throw reason
    }
    throw err
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onExternalAbort)
  }
}

export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const effectiveTimeout = resolveTimeoutMs(timeoutMs)
  const controller = new AbortController()
  let timedOut = false
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, effectiveTimeout)
  try {
    return await task(controller.signal)
  } catch (err) {
    if (timedOut) {
      throw new FetchTimeoutError(label, effectiveTimeout)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
