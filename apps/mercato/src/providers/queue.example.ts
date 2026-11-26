// Preview for the planned queue driver host. Copy this pattern to queue.ts
// after installing a release that supports it and its driver packages.
// QUEUE_STRATEGY=local selects the local driver (default).
// QUEUE_STRATEGY=async selects the BullMQ driver.

/*
import { defineQueueProviderRegistration } from '@open-mercato/queue/driver'
import localPackage from '@open-mercato/queue-provider-local/package.json'
import bullmqPackage from '@open-mercato/queue-provider-bullmq/package.json'

export const queueProviders = [
  defineQueueProviderRegistration({
    packageMetadata: localPackage,
    load: () => import('@open-mercato/queue-provider-local').then(({ queueDriver }) => queueDriver),
    settings: () => ({ baseDir: process.env.QUEUE_BASE_DIR ?? '.mercato/queue' }),
  }),
  defineQueueProviderRegistration({
    packageMetadata: bullmqPackage,
    load: () => import('@open-mercato/queue-provider-bullmq').then(({ queueDriver }) => queueDriver),
    settings: () => ({ connection: { url: process.env.QUEUE_REDIS_URL || process.env.REDIS_URL } }),
  }),
]
*/
