import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerCreditAccount, CustomerCreditLedgerEntry } from '../data/entities'
import { toMinorUnits, formatMinorUnits } from '../services/customerCreditService'
import { createCreditLimitExceededNotification, type ResolverContainer } from '../lib/creditNotifications'
import type { ProgressService } from '../../progress/lib/progressService'

const logger = createLogger('customer_groups')

// Release 5 Phase 3 (G21). Tenant-scoped, idempotent (a re-run recomputes the same sums
// and reports the same findings — it never writes to the ledger). Recomputes
// `SUM(amount)` per `CustomerCreditAccount` and compares it with the latest entry's
// `balance_after`; the comparison is only meaningful because `customerCreditService`
// writes `balance_after` under the row lock (G1, §6.3). A drift means a bug in that
// service, never a legitimate state, so every drifting account is logged AND reported
// through `reportError` for alerting; the `customer_groups.credit.limit_exceeded`
// notification is reused ONLY for a drifting account whose recomputed exposure is also
// over its limit (a genuine over-limit case) — a drift that stays under the limit is
// log/report-only, per the Step 1.8 brief ("do not invent a new notification type").
export const metadata: WorkerMeta = {
  queue: 'customer_groups.credit_exposure_audit',
  id: 'customer_groups:credit-exposure-audit',
  concurrency: 1,
}

type CreditExposureAuditPayload = {
  scope?: {
    tenantId?: string | null
    organizationId?: string | null
  }
  // Set only when enqueued from the admin credit list's "run now" action (G21: "Triggered
  // from the credit list it runs as a ProgressJob"). A scheduled daily run omits it.
  progressJobId?: string | null
}

type HandlerContext = JobContext & ResolverContainer & {
  container?: ResolverContainer
}

type AuditScope = { tenantId: string; organizationId: string }

export type CreditExposureDriftFinding = {
  creditAccountId: string
  customerId: string
  currencyCode: string
  recomputedExposure: string
  recordedBalanceAfter: string
  overLimit: boolean
}

const PAGE_SIZE = 200

type AccountCursor = string | null

function resolveContainer(ctx: HandlerContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

function readScope(payload: CreditExposureAuditPayload): AuditScope | null {
  const tenantId = payload.scope?.tenantId
  const organizationId = payload.scope?.organizationId
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) return null
  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) return null
  return { tenantId: tenantId.trim(), organizationId: organizationId.trim() }
}

function pageWhere(base: FilterQuery<CustomerCreditAccount>, cursor: AccountCursor): FilterQuery<CustomerCreditAccount> {
  if (!cursor) return base
  return { $and: [base, { id: { $gt: cursor } }] } as FilterQuery<CustomerCreditAccount>
}

function pickLatestEntry(entries: CustomerCreditLedgerEntry[]): CustomerCreditLedgerEntry | null {
  let latest: CustomerCreditLedgerEntry | null = null
  for (const entry of entries) {
    if (!latest) {
      latest = entry
      continue
    }
    const entryTime = entry.createdAt.getTime()
    const latestTime = latest.createdAt.getTime()
    if (entryTime > latestTime || (entryTime === latestTime && entry.id > latest.id)) latest = entry
  }
  return latest
}

// Re-derives exactly what `customerCreditService#sumExposure` computes under the lock,
// without the lock — this audit only reads, it never writes, so there is nothing to
// serialize against. Reusing `toMinorUnits`/`formatMinorUnits` keeps the rounding
// identical (G14), so legitimate 2-dp amounts never read as drift.
async function auditAccount(
  em: EntityManager,
  account: CustomerCreditAccount,
  scope: AuditScope,
): Promise<CreditExposureDriftFinding | null> {
  const entries = await em.find(CustomerCreditLedgerEntry, {
    tenantId: scope.tenantId,
    creditAccountId: account.id,
  })
  let sumMinorUnits = 0
  for (const entry of entries) sumMinorUnits += toMinorUnits(entry.amount)
  const recomputedExposure = formatMinorUnits(sumMinorUnits)

  const latest = pickLatestEntry(entries)
  const recordedBalanceAfter = latest ? latest.balanceAfter : '0.00'
  if (toMinorUnits(recomputedExposure) === toMinorUnits(recordedBalanceAfter)) return null

  return {
    creditAccountId: account.id,
    customerId: account.customerId,
    currencyCode: account.currencyCode,
    recomputedExposure,
    recordedBalanceAfter,
    overLimit: toMinorUnits(recomputedExposure) > toMinorUnits(account.creditLimit),
  }
}

export default async function handle(
  job: QueuedJob<CreditExposureAuditPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const container = resolveContainer(ctx)
  const em = ctx.resolve<EntityManager>('em').fork()
  const progressJobId = job.payload.progressJobId ?? null
  const progressService = progressJobId ? container.resolve<ProgressService>('progressService') : null
  const progressScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  if (progressJobId && progressService) await progressService.startJob(progressJobId, progressScope)

  const findings: CreditExposureDriftFinding[] = []
  let processedCount = 0

  try {
    const baseWhere: FilterQuery<CustomerCreditAccount> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    }

    let cursor: AccountCursor = null
    for (;;) {
      const accounts: CustomerCreditAccount[] = await em.find(CustomerCreditAccount, pageWhere(baseWhere, cursor), {
        orderBy: { id: 'ASC' },
        limit: PAGE_SIZE,
      })
      if (!accounts.length) break

      for (const account of accounts) {
        try {
          const finding = await auditAccount(em, account, scope)
          if (finding) {
            findings.push(finding)
            logger.warn('[customer_groups:credit-exposure-audit] exposure drift detected', {
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
              ...finding,
            })
            getTelemetryRuntime()?.reportError(
              new Error('[internal] customer_groups credit exposure drift'),
              {
                module: 'customer_groups',
                code: 'customer_groups.credit_exposure_drift',
                attributes: {
                  tenantId: scope.tenantId,
                  organizationId: scope.organizationId,
                  creditAccountId: finding.creditAccountId,
                },
              },
            )
            if (finding.overLimit) {
              await createCreditLimitExceededNotification(em, container, {
                tenantId: scope.tenantId,
                organizationId: scope.organizationId,
                creditAccountId: finding.creditAccountId,
                customerId: finding.customerId,
                currencyCode: finding.currencyCode,
                requestedAmount: finding.recomputedExposure,
                creditLimit: account.creditLimit,
              })
            }
          }
        } catch (error) {
          logger.error('[customer_groups:credit-exposure-audit] account audit failed', {
            err: error,
            creditAccountId: account.id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
          })
        }
        processedCount += 1
        if (progressJobId && progressService) await progressService.incrementProgress(progressJobId, 1, progressScope)
      }

      if (accounts.length < PAGE_SIZE) break
      cursor = accounts[accounts.length - 1].id
      em.clear()
    }

    if (progressJobId && progressService) {
      await progressService.completeJob(
        progressJobId,
        { resultSummary: { processedCount, driftCount: findings.length } },
        progressScope,
      )
    }
  } catch (error) {
    if (progressJobId && progressService) {
      await progressService.failJob(
        progressJobId,
        { errorMessage: error instanceof Error ? error.message : 'Credit exposure audit failed' },
        progressScope,
      )
    }
    throw error
  }
}
