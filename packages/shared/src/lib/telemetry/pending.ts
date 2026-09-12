import {
  recordTelemetryMetric,
  registerTelemetryMetricCollector,
} from './runtime'

export const DEFAULT_MAX_PENDING_OPERATIONS = 256
const DEFAULT_DROP_NOTIFICATION_INTERVAL_MS = 60_000

export type PendingOperationAdmission<T> =
  | { accepted: true; pending: number; promise: Promise<T> }
  | { accepted: false; pending: number }

export type BoundedPendingOperationTrackerOptions = {
  capacity: number
  stage: string
  now?: () => number
  onDrop?: (notification: { dropped: number; totalDropped: number }) => void
  onError?: (error: Error) => void
  dropNotificationIntervalMs?: number
}

export type BoundedPendingOperationTracker = {
  readonly capacity: number
  readonly dropped: number
  readonly pending: number
  tryStart<T>(factory: () => Promise<T> | T): PendingOperationAdmission<T>
  flush(): Promise<void>
  dispose(): void
}

export function parsePendingOperationCapacity(
  raw: string | undefined,
  fallback = DEFAULT_MAX_PENDING_OPERATIONS,
): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('[internal] pending operation tracker callback failed with a non-Error value')
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

export function createBoundedPendingOperationTracker(
  options: BoundedPendingOperationTrackerOptions,
): BoundedPendingOperationTracker {
  const now = options.now ?? defaultNow
  const dropNotificationIntervalMs = options.dropNotificationIntervalMs
    ?? DEFAULT_DROP_NOTIFICATION_INTERVAL_MS
  const pendingOperations = new Map<number, { promise: Promise<unknown>; startedAt: number }>()
  let nextOperationToken = 0
  let droppedCount = 0
  let droppedSinceLastNotification = 0
  let lastDropNotificationAt: number | null = null
  let disposeCollector: (() => void) | null = null
  let disposed = false

  const reportError = (error: unknown) => {
    try {
      options.onError?.(toError(error))
    } catch {}
  }

  const recordMetric = (point: Parameters<typeof recordTelemetryMetric>[0]) => {
    try {
      recordTelemetryMetric(point)
    } catch (error) {
      reportError(error)
    }
  }

  const collect = () => {
    let oldestStartedAt: number | null = null
    for (const { startedAt } of pendingOperations.values()) {
      if (oldestStartedAt === null || startedAt < oldestStartedAt) {
        oldestStartedAt = startedAt
      }
    }
    const oldestAgeSeconds = oldestStartedAt === null
      ? 0
      : Math.max(0, now() - oldestStartedAt) / 1000

    recordMetric({
      kind: 'gauge',
      name: 'om.audit_logs.pending_writes',
      value: pendingOperations.size,
      labels: { stage: options.stage },
      unit: '{task}',
    })
    recordMetric({
      kind: 'gauge',
      name: 'om.audit_logs.oldest_pending_age',
      value: oldestAgeSeconds,
      labels: { stage: options.stage },
      unit: 's',
    })
  }

  const ensureCollector = () => {
    if (disposeCollector || disposed) return
    disposeCollector = registerTelemetryMetricCollector(collect)
  }

  const stopCollector = () => {
    if (!disposeCollector) return
    disposeCollector()
    disposeCollector = null
  }

  const finish = (token: number) => {
    if (!pendingOperations.delete(token)) return
    if (pendingOperations.size === 0) {
      if (!disposed) collect()
      stopCollector()
    }
  }

  const notifyDrop = () => {
    const droppedAt = now()
    const shouldNotify = lastDropNotificationAt === null
      || droppedAt - lastDropNotificationAt >= dropNotificationIntervalMs
    if (!shouldNotify) return
    lastDropNotificationAt = droppedAt
    const dropped = droppedSinceLastNotification
    droppedSinceLastNotification = 0
    try {
      options.onDrop?.({ dropped, totalDropped: droppedCount })
    } catch (error) {
      reportError(error)
    }
  }

  const tracker: BoundedPendingOperationTracker = {
    capacity: options.capacity,
    get dropped() {
      return droppedCount
    },
    get pending() {
      return pendingOperations.size
    },
    tryStart<T>(factory: () => Promise<T> | T): PendingOperationAdmission<T> {
      if (disposed) {
        throw new Error('[internal] cannot start work on a disposed pending operation tracker')
      }
      if (pendingOperations.size >= options.capacity) {
        droppedCount += 1
        droppedSinceLastNotification += 1
        recordMetric({
          kind: 'counter',
          name: 'om.audit_logs.dropped',
          value: 1,
          labels: { stage: options.stage, reason: 'capacity' },
          unit: '{task}',
        })
        notifyDrop()
        return { accepted: false, pending: pendingOperations.size }
      }

      const token = nextOperationToken++
      let resolveOperation!: (value: T | PromiseLike<T>) => void
      let rejectOperation!: (reason: unknown) => void
      const promise = new Promise<T>((resolve, reject) => {
        resolveOperation = resolve
        rejectOperation = reject
      })
      pendingOperations.set(token, { promise, startedAt: now() })
      ensureCollector()
      void promise.then(
        () => finish(token),
        () => finish(token),
      )
      try {
        resolveOperation(factory())
      } catch (error) {
        rejectOperation(error)
      }
      return { accepted: true, pending: pendingOperations.size, promise }
    },
    async flush(): Promise<void> {
      while (pendingOperations.size > 0) {
        const snapshot = Array.from(pendingOperations.values(), ({ promise }) => promise)
        await Promise.allSettled(snapshot)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopCollector()
    },
  }

  return tracker
}
