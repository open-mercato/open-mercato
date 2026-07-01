import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import {
  Incident,
  IncidentSettings,
  IncidentSeverity,
  type IncidentEscalationPolicy,
} from '../data/entities'
import { emitIncidentsEvent } from '../events'
import {
  advanceEscalation,
  resolvePolicyForIncident,
  type IncidentScope,
} from '../services/escalationService'

export type EscalationSweepPayload = {
  scope: {
    tenantId: string
    organizationId: string
  }
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

type SchedulerPayload = Partial<EscalationSweepPayload> & {
  tenantId?: string | null
  organizationId?: string | null
}

const TERMINAL_STATUSES = ['resolved', 'closed'] as const
const DEFAULT_SLA_AT_RISK_PCT = 80

type ActiveUnacknowledgedWhere = {
  organizationId: string
  tenantId: string
  escalationStatus: 'active'
  acknowledgedAt: null
  status: { $nin: string[] }
  deletedAt: null
}

type AdvanceEscalationResult = Awaited<ReturnType<typeof advanceEscalation>>

export const metadata: WorkerMeta = {
  queue: 'incidents-escalation-sweep',
  id: 'incidents:escalation-sweep',
  concurrency: 1,
}

function scopeFromPayload(job: QueuedJob<EscalationSweepPayload>): IncidentScope | null {
  const rawJob = job as QueuedJob<EscalationSweepPayload> & { data?: EscalationSweepPayload }
  const raw = (rawJob.payload ?? rawJob.data ?? {}) as SchedulerPayload
  const tenantId = raw.scope?.tenantId ?? raw.tenantId ?? null
  const organizationId = raw.scope?.organizationId ?? raw.organizationId ?? null
  if (!tenantId || !organizationId) {
    console.warn('[incidents.escalation-sweep] skipping tick without complete scope', { payload: raw })
    return null
  }
  return { tenantId, organizationId }
}

function activeUnacknowledgedWhere(scope: IncidentScope): ActiveUnacknowledgedWhere {
  return {
    ...scope,
    escalationStatus: 'active',
    acknowledgedAt: null,
    status: { $nin: [...TERMINAL_STATUSES] },
    deletedAt: null,
  }
}

function warnIncidentFailure(pass: string, incident: Incident, err: unknown): void {
  console.warn(`[incidents.escalation-sweep] ${pass} failed for incident ${incident.id}`, err)
}

function delayForCurrentStep(policy: IncidentEscalationPolicy | null, incident: Incident): number | null {
  if (!policy || incident.escalationLevel < 0 || incident.escalationLevel >= policy.steps.length) return null
  const delayMinutes = policy.steps[incident.escalationLevel]?.delayMinutes
  return typeof delayMinutes === 'number' && Number.isFinite(delayMinutes) ? Math.max(0, delayMinutes) : 0
}

async function expireSnoozeForIncident(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  now: Date,
): Promise<void> {
  let policy: IncidentEscalationPolicy | null = null

  await withAtomicFlush(em, [
    async () => {
      policy = await resolvePolicyForIncident(em, scope, incident)
    },
    () => {
      incident.snoozedUntil = null
      const delayMinutes = delayForCurrentStep(policy, incident)
      if (delayMinutes != null) {
        incident.nextEscalationAt = new Date(now.getTime() + delayMinutes * 60_000)
      }
      incident.updatedAt = now
    },
  ], { transaction: true, label: 'incidents.escalation-sweep.snooze-expiry' })
}

async function runSnoozeExpiryPass(
  em: EntityManager,
  scope: IncidentScope,
  now: Date,
): Promise<void> {
  const incidents = await em.find(Incident, {
    ...activeUnacknowledgedWhere(scope),
    snoozedUntil: { $ne: null, $lte: now },
  })

  for (const incident of incidents) {
    try {
      await expireSnoozeForIncident(em, scope, incident, now)
    } catch (err) {
      warnIncidentFailure('snooze-expiry pass', incident, err)
    }
  }
}

async function advanceIncidentEscalation(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  now: Date,
): Promise<void> {
  let result: AdvanceEscalationResult | null = null
  await withAtomicFlush(em, [
    async () => {
      result = await advanceEscalation(em, scope, incident, {
        actorUserId: 'system',
        now,
        trigger: 'auto',
      })
    },
  ], { transaction: true, label: 'incidents.escalation-sweep.advance' })

  const committedResult = result as AdvanceEscalationResult | null
  if (!committedResult?.advanced) return
  for (const ev of committedResult.pendingEvents) {
    await emitIncidentsEvent(ev.id, ev.payload, { persistent: true })
  }
}

async function runEscalationAdvancePass(
  em: EntityManager,
  scope: IncidentScope,
  now: Date,
): Promise<void> {
  const incidents = await em.find(
    Incident,
    {
      ...activeUnacknowledgedWhere(scope),
      nextEscalationAt: { $ne: null, $lte: now },
      $or: [
        { snoozedUntil: null },
        { snoozedUntil: { $lte: now } },
      ],
    },
    { orderBy: { nextEscalationAt: 'asc' }, limit: 200 },
  )

  for (const incident of incidents) {
    try {
      await advanceIncidentEscalation(em, scope, incident, now)
    } catch (err) {
      warnIncidentFailure('escalation-advance pass', incident, err)
    }
  }
}

function dateMs(value: Date | null | undefined): number | null {
  if (!value) return null
  const ms = value.getTime()
  return Number.isFinite(ms) ? ms : null
}

function dueDateTimes(incident: Incident): number[] {
  return [
    dateMs(incident.slaResponseDueAt ?? null),
    dateMs(incident.slaResolutionDueAt ?? null),
  ].filter((value): value is number => value != null)
}

function startedAtMs(incident: Incident): number {
  return (
    dateMs(incident.startedAt ?? null) ??
    dateMs(incident.detectedAt ?? null) ??
    dateMs(incident.createdAt) ??
    Date.now()
  )
}

function atRiskPctForIncident(
  settings: IncidentSettings | null,
  severityKeyById: Map<string, string>,
  incident: Incident,
): number {
  const severityKey = severityKeyById.get(incident.severityId)
  const configured = severityKey ? settings?.slaTargets?.[severityKey]?.at_risk_pct : undefined
  return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0 && configured <= 100
    ? configured
    : DEFAULT_SLA_AT_RISK_PCT
}

function isAtRisk(dueMs: number, startMs: number, nowMs: number, atRiskPct: number): boolean {
  const thresholdMs = dueMs - (dueMs - startMs) * (1 - atRiskPct / 100)
  return nowMs >= thresholdMs
}

async function applySlaFlagsForIncident(
  em: EntityManager,
  incident: Incident,
  settings: IncidentSettings | null,
  severityKeyById: Map<string, string>,
  now: Date,
): Promise<void> {
  const nowMs = now.getTime()
  const dueTimes = dueDateTimes(incident)
  if (dueTimes.length === 0) return

  const shouldBreach = !incident.slaBreached && dueTimes.some((dueMs) => dueMs < nowMs)
  const startMs = startedAtMs(incident)
  const atRiskPct = atRiskPctForIncident(settings, severityKeyById, incident)
  const shouldMarkAtRisk =
    !shouldBreach &&
    !incident.slaBreached &&
    !incident.slaAtRisk &&
    dueTimes.some((dueMs) => isAtRisk(dueMs, startMs, nowMs, atRiskPct))

  if (!shouldBreach && !shouldMarkAtRisk) return

  await withAtomicFlush(em, [
    () => {
      if (shouldBreach && !incident.slaBreached) {
        incident.slaBreached = true
        incident.updatedAt = now
      } else if (shouldMarkAtRisk && !incident.slaAtRisk && !incident.slaBreached) {
        incident.slaAtRisk = true
        incident.updatedAt = now
      }
    },
  ], { transaction: true, label: 'incidents.escalation-sweep.sla' })
}

async function runSlaPass(
  em: EntityManager,
  scope: IncidentScope,
  now: Date,
): Promise<void> {
  const incidents = await em.find(Incident, {
    ...scope,
    status: { $nin: [...TERMINAL_STATUSES] },
    deletedAt: null,
    $or: [
      { slaResponseDueAt: { $ne: null } },
      { slaResolutionDueAt: { $ne: null } },
    ],
  })
  if (incidents.length === 0) return

  const settings = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
  const severities = await em.find(IncidentSeverity, { ...scope, deletedAt: null })
  const severityKeyById = new Map(severities.map((severity) => [severity.id, severity.key]))

  for (const incident of incidents) {
    try {
      await applySlaFlagsForIncident(em, incident, settings, severityKeyById, now)
    } catch (err) {
      warnIncidentFailure('sla pass', incident, err)
    }
  }
}

export default async function handle(
  job: QueuedJob<EscalationSweepPayload>,
  ctx: HandlerContext,
): Promise<void> {
  const scope = scopeFromPayload(job)
  if (!scope) return

  const em = (ctx.resolve('em') as EntityManager).fork()
  const now = new Date()

  await runSnoozeExpiryPass(em, scope, now)
  await runEscalationAdvancePass(em, scope, now)
  await runSlaPass(em, scope, now)
}
