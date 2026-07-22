export type WidgetDataBatchRequestEntry = { id: string; request: unknown }

export type WidgetDataBatchResultEntry =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string }

export type WidgetDataBatchSender = (
  entries: WidgetDataBatchRequestEntry[],
) => Promise<WidgetDataBatchResultEntry[]>

export type WidgetDataBatcherOptions = {
  send: WidgetDataBatchSender
  /** Coalescing window in ms. Widget requests fired within the window share one HTTP call. */
  windowMs?: number
  /** Upper bound on requests per HTTP call; larger queues are split into multiple sends. */
  maxBatchSize?: number
}

export type WidgetDataBatcher = {
  fetch: <TResponse>(request: unknown) => Promise<TResponse>
}

type PendingCall = {
  id: string
  request: unknown
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

const DEFAULT_WINDOW_MS = 16
const DEFAULT_MAX_BATCH_SIZE = 50

/**
 * Coalesces independent widget-data requests fired within a short window into a
 * single batch call. Each call resolves with its own slice of the batch result,
 * so callers stay decoupled from one another while collapsing N HTTP requests
 * (and N server-side container/RBAC/org-scope rebuilds) into one (see #2273).
 */
export function createWidgetDataBatcher(options: WidgetDataBatcherOptions): WidgetDataBatcher {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE

  let queue: PendingCall[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let counter = 0

  const flush = () => {
    timer = null
    const pending = queue
    queue = []
    if (pending.length === 0) return

    for (let start = 0; start < pending.length; start += maxBatchSize) {
      const chunk = pending.slice(start, start + maxBatchSize)
      void dispatchChunk(chunk)
    }
  }

  const dispatchChunk = async (chunk: PendingCall[]) => {
    try {
      const results = await options.send(chunk.map((call) => ({ id: call.id, request: call.request })))
      const byId = new Map<string, WidgetDataBatchResultEntry>()
      for (const result of results) byId.set(result.id, result)

      for (const call of chunk) {
        const result = byId.get(call.id)
        if (!result) {
          call.reject(new Error('No result returned for widget'))
        } else if (result.ok) {
          call.resolve(result.data)
        } else {
          call.reject(new Error(result.error))
        }
      }
    } catch (error) {
      for (const call of chunk) call.reject(error)
    }
  }

  const scheduleFlush = () => {
    if (timer != null) return
    timer = setTimeout(flush, windowMs)
  }

  return {
    fetch<TResponse>(request: unknown): Promise<TResponse> {
      counter += 1
      const id = `w${counter}`
      return new Promise<TResponse>((resolve, reject) => {
        queue.push({
          id,
          request,
          resolve: (value) => resolve(value as TResponse),
          reject,
        })
        scheduleFlush()
      })
    },
  }
}
