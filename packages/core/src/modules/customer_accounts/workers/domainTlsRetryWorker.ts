import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

export const metadata: WorkerMeta = {
  queue: 'domain-tls-retry',
  id: 'customer_accounts:domain-tls-retry',
  concurrency: 1,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

function parseInt32(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseFloat01(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '')
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return fallback
  return parsed
}

// In-process adaptive-backoff state. Worker is concurrency=1, so a single
// process owns this state. Surviving restarts is unnecessary because the
// scheduler will simply re-evaluate on the next tick. See spec
// "Phase 5 → Worker-level backoff" for the contract.
let backoffMultiplier = 1
let nextEligibleAt = 0

const BACKOFF_CAP_HOURS = 6

export default async function handle(_job: QueuedJob, ctx: HandlerContext): Promise<void> {
  const baseIntervalSeconds = parseInt32(process.env.DOMAIN_TLS_RETRY_INTERVAL_SECONDS, 1800)
  const batchSize = parseInt32(process.env.DOMAIN_TLS_RETRY_BATCH, 50)
  const maxRetries = parseInt32(process.env.DOMAIN_TLS_MAX_RETRIES, 6)
  const failureThreshold = parseFloat01(process.env.DOMAIN_TLS_RETRY_FAILURE_THRESHOLD, 0.8)
  const capSeconds = BACKOFF_CAP_HOURS * 3600
  const maxMultiplier = Math.max(1, Math.floor(capSeconds / baseIntervalSeconds))

  if (Date.now() < nextEligibleAt) return

  const service = ctx.resolve<DomainMappingService>('domainMappingService')
  const candidates = await service.findPendingTls({ maxRetries, batchSize })
  if (candidates.length === 0) {
    backoffMultiplier = 1
    nextEligibleAt = 0
    return
  }

  let attempted = 0
  let failed = 0
  for (const mapping of candidates) {
    attempted += 1
    try {
      const updated = await service.healthCheck(mapping.id)
      if (updated.status !== 'active') failed += 1
    } catch {
      failed += 1
    }
  }

  if (attempted === 0) return
  const failureRate = failed / attempted

  if (failureRate >= failureThreshold) {
    backoffMultiplier = Math.min(backoffMultiplier * 2, maxMultiplier)
    nextEligibleAt = Date.now() + backoffMultiplier * baseIntervalSeconds * 1000
  } else {
    backoffMultiplier = 1
    nextEligibleAt = 0
  }
}

// Test-only export so unit tests can reset state between runs.
export const __testing__ = {
  reset: () => {
    backoffMultiplier = 1
    nextEligibleAt = 0
  },
  getState: () => ({ backoffMultiplier, nextEligibleAt }),
}
