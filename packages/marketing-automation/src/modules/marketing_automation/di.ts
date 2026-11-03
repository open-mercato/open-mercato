import type { AwilixContainer } from 'awilix'
import { asValue } from 'awilix'
import { createGenericOptimisticLockReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  MarketingCampaign,
  MarketingCampaignRun,
  MarketingCampaignTrigger,
  MarketingDispatchDeadLetter,
  MarketingMessageSend,
} from './data/entities.js'
import { registerMarketingSteps } from './lib/engine/registry.js'
import { builtInSteps } from './steps/index.js'

const logger = createLogger('marketing_automation')

// Registered at module-DI load time rather than inside `register()` so the built-in step types
// are present before anything resolves the executor — a worker process that only touches the
// queue never calls `register()`, and an empty registry would make every step "unknown" and
// silently skip the whole campaign.
registerMarketingSteps(builtInSteps as never, logger)

// Also load-time, matching the platform's own convention for lock readers: the mutation guard
// snapshots the reader store early, so a reader registered lazily is absent from that snapshot
// and concurrent canvas saves would overwrite each other with no 409.
registerOptimisticLockReaders({
  'marketing_automation.campaign': createGenericOptimisticLockReader({
    entity: MarketingCampaign,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  }),
})

export function register(container: AwilixContainer): void {
  container.register({
    MarketingCampaign: asValue(MarketingCampaign),
    MarketingCampaignTrigger: asValue(MarketingCampaignTrigger),
    MarketingCampaignRun: asValue(MarketingCampaignRun),
    MarketingMessageSend: asValue(MarketingMessageSend),
    MarketingDispatchDeadLetter: asValue(MarketingDispatchDeadLetter),
  })
}
