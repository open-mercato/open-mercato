/**
 * Worker Registry
 *
 * Provides registration and lookup for auto-discovered queue workers.
 * Workers are registered during bootstrap and accessed by the CLI worker command.
 */

import type { WorkerDescriptor } from '../types'

const workers: Map<string, WorkerDescriptor> = new Map()

/**
 * Register a single worker.
 * @param worker - The worker descriptor to register
 */
export function registerWorker(worker: WorkerDescriptor): void {
  if (workers.has(worker.id)) {
    console.warn(`[worker-registry] Worker "${worker.id}" already registered, overwriting`)
  }
  workers.set(worker.id, worker)
}

/**
 * Register multiple workers at once (typically from module discovery).
 * @param list - Array of worker descriptors to register
 */
export function registerModuleWorkers(list: WorkerDescriptor[]): void {
  for (const worker of list) {
    registerWorker(worker)
  }
}

/**
 * Get all registered workers.
 * @returns Array of all worker descriptors
 */
export function getWorkers(): WorkerDescriptor[] {
  return Array.from(workers.values())
}

/**
 * Get workers registered for a specific queue.
 * @param queue - The queue name to filter by
 * @returns Array of workers for the specified queue
 */
export function getWorkersByQueue(queue: string): WorkerDescriptor[] {
  return Array.from(workers.values()).filter((w) => w.queue === queue)
}

/**
 * Get a specific worker by ID.
 * @param id - The worker ID to look up
 * @returns The worker descriptor if found, undefined otherwise
 */
export function getWorker(id: string): WorkerDescriptor | undefined {
  return workers.get(id)
}

/**
 * Get all unique queue names that have registered workers.
 * @returns Array of queue names
 */
export function getRegisteredQueues(): string[] {
  const queues = new Set<string>()
  for (const worker of workers.values()) {
    queues.add(worker.queue)
  }
  return Array.from(queues)
}

/**
 * Clear all registered workers (useful for testing).
 */
export function clearWorkers(): void {
  workers.clear()
}
