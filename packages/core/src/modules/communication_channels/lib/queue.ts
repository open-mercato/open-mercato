import { createModuleQueue, type Queue } from '@open-mercato/queue'

/**
 * Queue helper for the communication_channels hub. Mirrors the
 * shipping_carriers pattern (`getShippingCarrierQueue`) so the route
 * and the worker share the same queue instance.
 *
 * Worker concurrency is also tunable via env (`COMMUNICATION_CHANNELS_QUEUE_CONCURRENCY`)
 * with a sensible default of 10 (per SPEC-045d §6 inbound flow) and a hard ceiling of
 * 20 (ARCHITECTURE §19 caps queue/worker concurrency at 20).
 */
const queues = new Map<string, Queue<Record<string, unknown>>>()

export function getCommunicationChannelsQueue(queueName: string): Queue<Record<string, unknown>> {
  const existing = queues.get(queueName)
  if (existing) return existing

  const concurrency = Math.min(
    20,
    Math.max(
      1,
      Number.parseInt(process.env.COMMUNICATION_CHANNELS_QUEUE_CONCURRENCY ?? '10', 10) || 10,
    ),
  )
  const created = createModuleQueue<Record<string, unknown>>(queueName, { concurrency })
  queues.set(queueName, created)
  return created
}

/** Canonical queue names exposed by the hub. */
export const COMMUNICATION_CHANNELS_QUEUES = {
  inbound: 'communication-channels-inbound',
  outbound: 'communication-channels-outbound',
  reactions: 'communication-channels-reactions',
  /**
   * Per-channel polling queue (email integration spec — Phase 0 Delta 6).
   * Populated by `poll-tick` every scheduler tick; one entry per due channel.
   * Processed by `workers/poll-channel.ts`.
   */
  poll: 'communication-channels-poll',
  /**
   * Hub-internal tick queue (email integration spec — Phase 0 Delta 6).
   * One job per scheduler tick (60s default); worker enumerates due channels
   * and fans out to the `poll` queue.
   */
  pollTick: 'communication-channels-poll-tick',
  /**
   * Operator-triggered channel-history import queue (Spec B § Phase B6).
   * One job per `/import-history` call; worker `channel-import-history` runs
   * with concurrency 1 to avoid hammering the provider with parallel scans.
   */
  importHistory: 'communication-channels-import-history',
  /**
   * Spec C § Phase C2 — Gmail Pub/Sub push delivery. The webhook enqueues
   * one job per verified notification; the worker calls
   * `adapter.applyPushNotification` (which delegates to `history.list`).
   */
  gmailHistorySync: 'communication-channels-gmail-history-sync',
  /**
   * Spec C § Phase C4 — Renewal cron queues (daily / 2h cadence).
   */
  gmailRenewWatch: 'communication-channels-gmail-renew-watch',
} as const

export type CommunicationChannelsQueueName =
  (typeof COMMUNICATION_CHANNELS_QUEUES)[keyof typeof COMMUNICATION_CHANNELS_QUEUES]
