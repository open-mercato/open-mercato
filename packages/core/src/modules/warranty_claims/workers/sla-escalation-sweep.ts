import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildFeatureNotificationFromType, buildNotificationFromType } from '../../notifications/lib/notificationBuilder'
import { resolveNotificationService } from '../../notifications/lib/notificationService'
import { CLAIM_STATUSES, type WarrantyClaimStatus } from '../data/validators'
import { WarrantyClaim } from '../data/entities'
import { emitWarrantyClaimsEvent } from '../events'
import { businessMillisBetween, slaProgressPctFromDue } from '../lib/businessHours'
import {
  isSlaEscalationCandidate,
  isSlaEscalationTerminalStatus,
  parseEscalationTiers,
  tiersToFire,
  type EscalationTier,
} from '../lib/escalation'
import { resolveEffectiveWarrantyClaimSettings } from '../lib/settings'
import { notificationTypes } from '../notifications'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

type SlaEscalationSweepPayload = {
  scope?: {
    organizationId?: string | null
    tenantId?: string | null
  }
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type HandlerContext = JobContext & ResolverContainer & {
  container?: ResolverContainer
}

type EscalateClaimCommandInput = {
  id: string
  organizationId: string
  tenantId: string
  toLevel: number
  reassignToUserId?: string
}

type EscalateClaimCommandResult = {
  claimId: string
  escalationLevel: number
  escalated: boolean
}

type SweepScope = {
  tenantId: string
  organizationId: string
}

const ACTIVE_SLA_STATUSES = CLAIM_STATUSES.filter(
  (status): status is WarrantyClaimStatus => !isSlaEscalationTerminalStatus(status),
)

export const metadata: WorkerMeta = {
  queue: 'warranty_claims.sla_sweep',
  id: 'warranty_claims:sla-escalation-sweep',
  concurrency: 1,
}

function resolveContainer(ctx: HandlerContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

function readScope(payload: SlaEscalationSweepPayload): SweepScope | null {
  const tenantId = payload.scope?.tenantId
  const organizationId = payload.scope?.organizationId
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) return null
  if (typeof organizationId !== 'string' || organizationId.trim().length === 0) return null
  return { tenantId: tenantId.trim(), organizationId: organizationId.trim() }
}

function claimEventPayload(claim: WarrantyClaim, scope: SweepScope): Record<string, unknown> {
  return {
    id: claim.id,
    claimId: claim.id,
    claimNumber: claim.claimNumber,
    claimType: claim.claimType,
    status: claim.status,
    customerId: claim.customerId ?? null,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  }
}

function roundedPct(value: number): number {
  return Math.round(value * 100) / 100
}

async function emitSlaSignal(
  eventId: 'warranty_claims.claim.sla_at_risk' | 'warranty_claims.claim.sla_breached',
  claim: WarrantyClaim,
  scope: SweepScope,
  progressPct: number,
  elapsedBusinessMillis: number,
): Promise<void> {
  await emitWarrantyClaimsEvent(eventId, {
    ...claimEventPayload(claim, scope),
    progressPct: roundedPct(progressPct),
    elapsedBusinessMillis,
    slaDueAt: claim.slaDueAt?.toISOString() ?? null,
  }, { persistent: true })
}

type SlaSignalGuard = 'slaAtRiskNotifiedAt' | 'slaBreachedNotifiedAt'

// Claims the right to emit an SLA signal by stamping the guard column only while it
// is still null. The stamp is the serialization point: two sweeps racing the same
// claim (or a retry after a crash) see exactly one `affected === 1`, so the signal is
// emitted once. Emitting first and stamping afterwards would double-notify.
async function claimSlaSignal(
  em: EntityManager,
  claim: WarrantyClaim,
  scope: SweepScope,
  guard: SlaSignalGuard,
  stamps: Partial<Pick<WarrantyClaim, 'slaAtRiskNotifiedAt' | 'slaBreachedNotifiedAt'>>,
): Promise<boolean> {
  const affected = await em.nativeUpdate(
    WarrantyClaim,
    { id: claim.id, tenantId: scope.tenantId, organizationId: scope.organizationId, [guard]: null },
    stamps,
  )
  return affected === 1
}

// Releases a claimed guard so the next sweep retries, used when the emit that the
// claim was taken for fails. Without it a failed emit would be silently swallowed.
async function releaseSlaSignal(
  em: EntityManager,
  claim: WarrantyClaim,
  scope: SweepScope,
  guard: SlaSignalGuard,
): Promise<void> {
  await em.nativeUpdate(
    WarrantyClaim,
    { id: claim.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { [guard]: null },
  )
}

async function emitClaimedSlaSignal(
  em: EntityManager,
  claim: WarrantyClaim,
  scope: SweepScope,
  guard: SlaSignalGuard,
  stamps: Partial<Pick<WarrantyClaim, 'slaAtRiskNotifiedAt' | 'slaBreachedNotifiedAt'>>,
  emit: () => Promise<void>,
): Promise<void> {
  if (!(await claimSlaSignal(em, claim, scope, guard, stamps))) return
  try {
    await emit()
  } catch (error) {
    await releaseSlaSignal(em, claim, scope, guard)
    throw error
  }
}

function buildCommandContext(container: ResolverContainer, scope: SweepScope): CommandRuntimeContext {
  return {
    container: container as unknown as AwilixContainer,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

async function createEscalationNotification(
  container: ResolverContainer,
  claim: WarrantyClaim,
  scope: SweepScope,
  tierIndex: number,
  progressPct: number,
): Promise<void> {
  const typeDef = notificationTypes.find((type) => type.type === 'warranty_claims.claim.escalated')
  if (!typeDef) return

  const notificationService = resolveNotificationService(container)
  const common = {
    bodyVariables: {
      claimNumber: claim.claimNumber,
      level: String(tierIndex),
      progressPct: String(Math.round(progressPct)),
    },
    sourceEntityType: 'warranty_claims:warranty_claim',
    sourceEntityId: claim.id,
    linkHref: `/backend/warranty_claims/${claim.id}`,
    groupKey: `warranty_claims.claim.escalated:${claim.id}:${tierIndex}`,
  }

  if (claim.assigneeUserId) {
    await notificationService.create(buildNotificationFromType(typeDef, {
      ...common,
      recipientUserId: claim.assigneeUserId,
    }), scope)
  }

  await notificationService.createForFeature(buildFeatureNotificationFromType(typeDef, {
    ...common,
    requiredFeature: 'warranty_claims.claim.manage',
  }), scope)
}

async function runEscalationTier(
  container: ResolverContainer,
  scope: SweepScope,
  claim: WarrantyClaim,
  tierIndex: number,
  tier: EscalationTier,
  progressPct: number,
): Promise<void> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const input: EscalateClaimCommandInput = {
    id: claim.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    toLevel: tierIndex,
    ...(tier.action === 'reassign' && tier.toUserId ? { reassignToUserId: tier.toUserId } : {}),
  }
  const { result } = await commandBus.execute<EscalateClaimCommandInput, EscalateClaimCommandResult>(
    'warranty_claims.claim.escalate',
    { input, ctx: buildCommandContext(container, scope) },
  )
  if (!result.escalated) return
  if (tier.action === 'notify') {
    await createEscalationNotification(container, claim, scope, tierIndex, progressPct)
  }
}

function logClaimSweepError(claimId: string, error: unknown): void {
  logger.warn('[warranty_claims:sla-escalation-sweep] claim failed', {
    claimId,
    error: error instanceof Error ? error.message : error,
  })
}

export default async function handle(
  job: QueuedJob<SlaEscalationSweepPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const scope = readScope(job.payload)
  if (!scope) return

  const container = resolveContainer(ctx)
  const em = ctx.resolve<EntityManager>('em').fork()
  const settings = await resolveEffectiveWarrantyClaimSettings(em, scope)
  const tiers = parseEscalationTiers(settings.escalationTiers)
  const now = new Date()

  const where: FilterQuery<WarrantyClaim> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    slaPausedAt: null,
    slaDueAt: { $ne: null },
    submittedAt: { $ne: null },
    status: { $in: ACTIVE_SLA_STATUSES },
  }
  const claims = await findWithDecryption(
    em,
    WarrantyClaim,
    where,
    { orderBy: { slaDueAt: 'ASC' } },
    scope,
  )

  for (const claim of claims) {
    if (!isSlaEscalationCandidate(claim)) continue
    const submittedAt = claim.submittedAt
    const slaDueAt = claim.slaDueAt
    if (!submittedAt || !slaDueAt) continue
    try {
      const elapsedBusinessMillis = businessMillisBetween(submittedAt, now, settings.businessHours)
      // Anchor progress on `slaDueAt` — the pause-shifted deadline the stats
      // endpoint reads — so pause/resume and escalation share one time base.
      const progressPct = slaProgressPctFromDue(now, slaDueAt, settings.slaHours, settings.businessHours)

      if (
        progressPct >= settings.slaAtRiskThresholdPct &&
        progressPct < 100 &&
        !claim.slaAtRiskNotifiedAt
      ) {
        await emitClaimedSlaSignal(
          em,
          claim,
          scope,
          'slaAtRiskNotifiedAt',
          { slaAtRiskNotifiedAt: now },
          () => emitSlaSignal('warranty_claims.claim.sla_at_risk', claim, scope, progressPct, elapsedBusinessMillis),
        )
      }
      if (progressPct >= 100 && !claim.slaBreachedNotifiedAt) {
        await emitClaimedSlaSignal(
          em,
          claim,
          scope,
          'slaBreachedNotifiedAt',
          { slaBreachedNotifiedAt: now, slaAtRiskNotifiedAt: claim.slaAtRiskNotifiedAt ?? now },
          () => emitSlaSignal('warranty_claims.claim.sla_breached', claim, scope, progressPct, elapsedBusinessMillis),
        )
      }

      const fire = tiersToFire(progressPct, claim.escalationLevel ?? 0, tiers)
      for (const entry of fire) {
        await runEscalationTier(container, scope, claim, entry.tierIndex, entry.tier, progressPct)
      }
    } catch (error) {
      logClaimSweepError(claim.id, error)
    }
  }
}
