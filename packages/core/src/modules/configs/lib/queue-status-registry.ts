import { getModules } from '@open-mercato/shared/lib/modules/registry'
import type { ModuleWorker } from '@open-mercato/shared/modules/registry'
import { createModuleQueue, resolveQueueStrategy, type Queue } from '@open-mercato/queue'

/**
 * Enumerate registered queues by grouping every module's declared workers by
 * queue name, mirroring `scheduler/lib/safeQueueTargets.ts`'s
 * `collectQueueConsumers` — the Next.js app process and the CLI worker process
 * both derive their queue list from the same generated module registry, so the
 * dashboard and the worker runtime always agree on what exists (#3105).
 */
const queueConsumerCache = new WeakMap<object, Map<string, ModuleWorker[]>>()

function collectQueueConsumers(): Map<string, ModuleWorker[]> {
  let modules: ReturnType<typeof getModules>
  try {
    modules = getModules()
  } catch {
    return new Map()
  }
  const cached = queueConsumerCache.get(modules)
  if (cached) return cached

  const byQueue = new Map<string, ModuleWorker[]>()
  for (const mod of modules) {
    for (const worker of mod.workers ?? []) {
      if (!worker.queue) continue
      const consumers = byQueue.get(worker.queue) ?? []
      consumers.push(worker)
      byQueue.set(worker.queue, consumers)
    }
  }
  queueConsumerCache.set(modules, byQueue)
  return byQueue
}

export type RegisteredQueueInfo = {
  queue: string
  workerIds: string[]
  /** Declared concurrency, when every worker on the queue agrees; null when they differ or none declare it. */
  concurrency: number | null
}

/** Every registered queue, alphabetically, with its declared worker ids and concurrency. */
export function listRegisteredQueues(): RegisteredQueueInfo[] {
  const entries: RegisteredQueueInfo[] = []
  for (const [queue, consumers] of collectQueueConsumers()) {
    const workerIds = consumers.map((worker) => worker.id).filter((id): id is string => typeof id === 'string')
    const concurrencies = new Set(consumers.map((worker) => worker.concurrency ?? 1))
    entries.push({
      queue,
      workerIds,
      concurrency: concurrencies.size === 1 ? [...concurrencies][0] : null,
    })
  }
  entries.sort((a, b) => a.queue.localeCompare(b.queue))
  return entries
}

/**
 * Process-lifetime cache of `Queue` instances this admin surface resolved for
 * status reads, mirroring the per-module singleton pattern every queue-owning
 * module already uses (e.g. `data_sync/lib/queue.ts`'s own `Map`) — never
 * created-and-closed per request, which would churn a fresh Redis connection
 * on every dashboard refresh. This is a second, separate connection from
 * whichever the owning module itself holds for enqueue/process; there is no
 * shared instance registry to reuse across modules today.
 */
const statusQueues = new Map<string, Queue>()

export function resolveStatusQueue(queueName: string): Queue {
  const existing = statusQueues.get(queueName)
  if (existing) return existing
  const created = createModuleQueue(queueName)
  statusQueues.set(queueName, created)
  return created
}

export function currentQueueStrategy(): 'local' | 'async' {
  return resolveQueueStrategy()
}

/** Test-only: drop every cached queue instance so a new strategy/env takes effect. */
export function resetStatusQueueCacheForTests(): void {
  statusQueues.clear()
}
