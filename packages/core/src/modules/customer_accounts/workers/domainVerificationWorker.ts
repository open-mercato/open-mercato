import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

export const metadata: WorkerMeta = {
  queue: 'domain-verification',
  id: 'customer_accounts:domain-verification',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function parseSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const service = ctx.resolve<DomainMappingService>('domainMappingService')

  const intervalSeconds = parseSeconds(process.env.DOMAIN_AUTO_VERIFY_INTERVAL_SECONDS, 300)
  const olderThanMs = intervalSeconds * 1000

  const candidates = await service.findPendingVerification({ olderThanMs })
  if (candidates.length === 0) return

  for (const mapping of candidates) {
    try {
      const result = await service.verify(mapping.id)
      if (result.domainMapping.status === 'verified') {
        try {
          await service.healthCheck(mapping.id)
        } catch {
          // healthCheck emits its own events on failure; swallow here so one
          // bad domain doesn't poison the rest of the batch.
        }
      }
    } catch {
      // verify() emits dns_failed events on negative results. A thrown error
      // here is unexpected (e.g. DB blip) — skip and let the next tick retry.
    }
  }
}
