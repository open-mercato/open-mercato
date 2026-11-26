// Preview of the queue driver registration contract. Activate this pattern in
// queue.ts once the installed host and provider package support it.
// At runtime use QUEUE_STRATEGY=npm:@partner/mercato-queue-example.

/*
import packageMetadata from '@partner/mercato-queue-example/package.json'
import { defineQueueProviderRegistration } from '@open-mercato/queue/driver'

export const queueProviders = [
  defineQueueProviderRegistration({
    packageMetadata,
    load: () => import('@partner/mercato-queue-example').then(({ queueDriver }) => queueDriver),
  }),
]
*/
