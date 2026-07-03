import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  Incident,
  IncidentEscalationPolicy,
  IncidentParticipant,
  IncidentSettings,
  IncidentTimelineEntry,
  IncidentType,
  type IncidentEscalationLastTargets,
  type IncidentEscalationStep,
  type IncidentEscalationTarget,
} from '../data/entities'
import type { IncidentsEventId } from '../events'

export type { IncidentEscalationTarget } from '../data/entities'

export type IncidentScope = { organizationId: string; tenantId: string }

export type EscalationRecipient = { userId: string; label?: string }

type OptionalResolverContainer = {
  resolve<T = unknown>(name: string, opts?: { allowUnregistered?: boolean }): T
}

type StaffTeamMemberResolver = {
  resolveIncidentTeamRecipients(input: {
    organizationId: string
    tenantId: string
    teamId: string
    at?: Date
  }): Promise<EscalationRecipient[]>
}

type RecipientResolutionOptions = {
  container?: OptionalResolverContainer
  now?: Date
}

export type PendingEscalationEvent = {
  id: IncidentsEventId
  payload: Record<string, unknown>
}

type EscalationMutationResult = {
  pendingEvents: PendingEscalationEvent[]
}

type StartEscalationResult = EscalationMutationResult & {
  started: boolean
  recipients: EscalationRecipient[]
  level: number
}

type AdvanceTrigger = 'manual' | 'auto' | 'manual_after_ack'

type AdvanceEscalationResult = EscalationMutationResult & {
  advanced: boolean
  exhausted: boolean
  level: number
  escalationStatus: string
  nextEscalationAt: Date | null
  recipients: EscalationRecipient[]
}

function hasSteps(policy: IncidentEscalationPolicy | null): policy is IncidentEscalationPolicy {
  return Boolean(policy?.isActive && !policy.deletedAt && Array.isArray(policy.steps) && policy.steps.length >= 1)
}

async function findActivePolicy(
  em: EntityManager,
  scope: IncidentScope,
  policyId: string | null | undefined,
): Promise<IncidentEscalationPolicy | null> {
  if (!policyId) return null
  const policy = await em.findOne(IncidentEscalationPolicy, {
    id: policyId,
    ...scope,
    isActive: true,
    deletedAt: null,
  })
  return hasSteps(policy) ? policy : null
}

function appendEscalationTimeline(input: {
  em: EntityManager
  scope: IncidentScope
  incidentId: string
  actorUserId: string
  metadata: Record<string, unknown>
  now: Date
}): void {
  const entry = input.em.create(IncidentTimelineEntry, {
    organizationId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    incidentId: input.incidentId,
    kind: 'escalation',
    // TODO(packet-w2a): Timeline actor_user_id is uuid-only; represent system actor as null until a system actor id is standardized.
    actorUserId: input.actorUserId === 'system' ? null : input.actorUserId,
    body: null,
    visibility: 'internal',
    metadata: input.metadata,
    createdAt: input.now,
  })
  input.em.persist(entry)
}

function eventPayload(
  scope: IncidentScope,
  incident: Incident,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: incident.id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    ...extra,
  }
}

function buildLastTargets(
  step: IncidentEscalationStep,
  recipients: EscalationRecipient[],
  now: Date,
): IncidentEscalationLastTargets {
  return {
    targets: step.targets,
    recipients,
    resolvedAt: now.toISOString(),
  }
}

function addRecipient(
  recipientsByUserId: Map<string, EscalationRecipient>,
  recipient: EscalationRecipient,
): void {
  const userId = recipient.userId.trim()
  if (!userId || recipientsByUserId.has(userId)) return
  recipientsByUserId.set(userId, { ...recipient, userId })
}

function resolveOptionalStaffTeamMemberResolver(
  container: OptionalResolverContainer | undefined,
): StaffTeamMemberResolver | null {
  if (!container) return null
  try {
    return container.resolve<StaffTeamMemberResolver | null>('staffTeamMemberResolver', {
      allowUnregistered: true,
    }) ?? null
  } catch {
    return null
  }
}

function policyStep(policy: IncidentEscalationPolicy, level: number): IncidentEscalationStep {
  const step = policy.steps[level]
  if (!step) {
    throw new CrudHttpError(409, { error: '[internal] escalation_step_missing' })
  }
  return step
}

function computeNextStep(
  incident: Incident,
  policy: IncidentEscalationPolicy,
): { nextLevel: number; repeatsDone: number; willExhaust: boolean } {
  const expectedLevel = incident.escalationLevel
  const repeatsDone = incident.escalationRepeatsDone
  if (expectedLevel + 1 < policy.steps.length) {
    return { nextLevel: expectedLevel + 1, repeatsDone, willExhaust: false }
  }
  if (repeatsDone < policy.repeatCount) {
    return { nextLevel: 0, repeatsDone: repeatsDone + 1, willExhaust: false }
  }
  return { nextLevel: expectedLevel, repeatsDone, willExhaust: true }
}

function terminalIncidentStatus(status: string): boolean {
  return status === 'resolved' || status === 'closed'
}

async function reactivateAcknowledgedEscalation(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  opts: { actorUserId: string; now: Date },
): Promise<boolean> {
  const rows = await em.getConnection().execute<{ id: string }[]>(
    `update "incidents" set "escalation_status" = 'active', "snoozed_until" = null, "updated_at" = now()
     where "id" = ? and "organization_id" = ? and "tenant_id" = ? and "escalation_status" = 'acknowledged' and "deleted_at" is null and "status" not in ('resolved','closed')
     returning "id"`,
    [incident.id, scope.organizationId, scope.tenantId],
  )
  const claimed = Array.isArray(rows) && rows.length > 0
  if (!claimed) return false

  incident.escalationStatus = 'active'
  incident.snoozedUntil = null
  incident.updatedAt = new Date()
  appendEscalationTimeline({
    em,
    scope,
    incidentId: incident.id,
    actorUserId: opts.actorUserId,
    metadata: { trigger: 'manual_after_ack' },
    now: opts.now,
  })
  return true
}

export async function resolveStepRecipients(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  step: IncidentEscalationStep,
  opts: RecipientResolutionOptions = {},
): Promise<{ targets: IncidentEscalationTarget[]; recipients: EscalationRecipient[] }> {
  const recipientsByUserId = new Map<string, EscalationRecipient>()
  const staffTeamMemberResolver = resolveOptionalStaffTeamMemberResolver(opts.container)
  if (incident.ownerUserId) addRecipient(recipientsByUserId, { userId: incident.ownerUserId })

  for (const target of step.targets) {
    if (target.type === 'user') {
      addRecipient(recipientsByUserId, { userId: target.id })
      continue
    }

    if (target.type === 'role') {
      const participants = await em.find(IncidentParticipant, {
        incidentId: incident.id,
        roleId: target.id,
        ...scope,
        deletedAt: null,
      })
      for (const participant of participants) {
        addRecipient(recipientsByUserId, { userId: participant.userId })
      }
      continue
    }

    if (target.type === 'team' && staffTeamMemberResolver) {
      try {
        const teamRecipients = await staffTeamMemberResolver.resolveIncidentTeamRecipients({
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          teamId: target.id,
          at: opts.now,
        })
        for (const recipient of teamRecipients) {
          addRecipient(recipientsByUserId, recipient)
        }
      } catch (error) {
        console.warn('[incidents.escalation] failed to resolve team recipients', {
          incidentId: incident.id,
          teamId: target.id,
          error,
        })
      }
    }
  }

  return {
    targets: step.targets,
    recipients: Array.from(recipientsByUserId.values()),
  }
}

export async function resolvePolicyForIncident(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
): Promise<IncidentEscalationPolicy | null> {
  return findActivePolicy(em, scope, incident.escalationPolicyId ?? null)
}

export async function resolveDefaultPolicyId(
  em: EntityManager,
  scope: IncidentScope,
  incidentTypeId: string | null,
): Promise<string | null> {
  let candidatePolicyId: string | null = null
  if (incidentTypeId) {
    const type = await em.findOne(IncidentType, { id: incidentTypeId, ...scope, deletedAt: null })
    candidatePolicyId = type?.defaultEscalationPolicyId ?? null
  }

  if (!candidatePolicyId) {
    const settings = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
    candidatePolicyId = settings?.defaultEscalationPolicyId ?? null
  }

  const policy = await findActivePolicy(em, scope, candidatePolicyId)
  return policy?.id ?? null
}

export async function startEscalation(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  opts: { actorUserId: string; now: Date; container?: OptionalResolverContainer },
): Promise<StartEscalationResult> {
  if (
    incident.escalationStatus !== 'inactive' ||
    incident.acknowledgedAt != null ||
    terminalIncidentStatus(incident.status)
  ) {
    return { started: false, recipients: [], level: incident.escalationLevel, pendingEvents: [] }
  }

  const policy = await resolvePolicyForIncident(em, scope, incident)
  if (!policy) {
    incident.escalationStatus = 'inactive'
    return { started: false, recipients: [], level: incident.escalationLevel, pendingEvents: [] }
  }

  // NOTE: the inactive->active START transition mutates in-memory and relies on the caller's
  // optimistic-lock header (the war-room always sends it) for idempotency, rather than an atomic
  // conditional claim like advanceEscalation/reactivateAcknowledgedEscalation. A CAS here is avoided
  // because start-on-create runs before the incident row is committed; a header-less concurrent
  // double-start can therefore emit duplicate start events (rare; final state stays consistent).
  const step = policyStep(policy, 0)
  const { recipients } = await resolveStepRecipients(em, scope, incident, step, {
    container: opts.container,
    now: opts.now,
  })
  const nextEscalationAt = new Date(opts.now.getTime() + step.delayMinutes * 60_000)
  incident.escalationStatus = 'active'
  incident.escalationLevel = 0
  incident.escalationRepeatsDone = 0
  incident.escalationLastTargets = buildLastTargets(step, recipients, opts.now)
  incident.nextEscalationAt = nextEscalationAt
  incident.snoozedUntil = null
  incident.updatedAt = opts.now

  appendEscalationTimeline({
    em,
    scope,
    incidentId: incident.id,
    actorUserId: opts.actorUserId,
    metadata: {
      trigger: 'start',
      toLevel: 0,
      policyKey: policy.key,
      recipients: recipients.map((recipient) => recipient.userId),
    },
    now: opts.now,
  })

  return {
    started: true,
    recipients,
    level: 0,
    pendingEvents: [{
      id: 'incidents.incident.escalation_started',
      payload: eventPayload(scope, incident, {
        actorUserId: opts.actorUserId,
        level: 0,
        escalationStatus: 'active',
        policyId: policy.id,
        recipientUserIds: recipients.map((recipient) => recipient.userId),
        dedupeKey: `incidents.escalation:${incident.id}:0:0`,
      }),
    }],
  }
}

export async function advanceEscalation(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  opts: { actorUserId: string; now: Date; trigger: AdvanceTrigger; container?: OptionalResolverContainer },
): Promise<AdvanceEscalationResult> {
  const policy = await resolvePolicyForIncident(em, scope, incident)
  if (!policy) {
    return {
      advanced: false,
      exhausted: false,
      level: incident.escalationLevel,
      escalationStatus: incident.escalationStatus,
      nextEscalationAt: incident.nextEscalationAt ?? null,
      recipients: [],
      pendingEvents: [],
    }
  }

  const expectedLevel = incident.escalationLevel
  const currentRepeatsDone = incident.escalationRepeatsDone
  const next = computeNextStep(incident, policy)
  const isExhaust = next.willExhaust
  let recipients: EscalationRecipient[] = []
  let newLastTargets: IncidentEscalationLastTargets | null = incident.escalationLastTargets ?? null
  let newNextAt: Date | null = null

  if (!isExhaust) {
    const step = policyStep(policy, next.nextLevel)
    const resolved = await resolveStepRecipients(em, scope, incident, step, {
      container: opts.container,
      now: opts.now,
    })
    recipients = resolved.recipients
    newLastTargets = buildLastTargets(step, recipients, opts.now)
    newNextAt = new Date(opts.now.getTime() + step.delayMinutes * 60_000)
  }

  const rows = await em.getConnection().execute<{ id: string }[]>(
    `update "incidents" set "escalation_level" = ?, "escalation_repeats_done" = ?, "escalation_status" = ?, "next_escalation_at" = ?, "escalation_last_targets" = ?::jsonb, "snoozed_until" = null, "updated_at" = now() where "id" = ? and "organization_id" = ? and "tenant_id" = ? and "escalation_level" = ? and "escalation_status" = 'active' and "deleted_at" is null and "status" not in ('resolved','closed') returning "id"`,
    [
      isExhaust ? expectedLevel : next.nextLevel,
      isExhaust ? currentRepeatsDone : next.repeatsDone,
      isExhaust ? 'exhausted' : 'active',
      newNextAt,
      JSON.stringify(newLastTargets ?? null),
      incident.id,
      scope.organizationId,
      scope.tenantId,
      expectedLevel,
    ],
  )
  const claimed = Array.isArray(rows) && rows.length > 0
  if (!claimed) {
    return {
      advanced: false,
      exhausted: false,
      level: incident.escalationLevel,
      escalationStatus: incident.escalationStatus,
      nextEscalationAt: incident.nextEscalationAt ?? null,
      recipients: [],
      pendingEvents: [],
    }
  }

  incident.escalationLevel = isExhaust ? expectedLevel : next.nextLevel
  incident.escalationRepeatsDone = isExhaust ? currentRepeatsDone : next.repeatsDone
  incident.escalationStatus = isExhaust ? 'exhausted' : 'active'
  incident.nextEscalationAt = newNextAt
  incident.escalationLastTargets = newLastTargets ?? incident.escalationLastTargets
  incident.snoozedUntil = null
  incident.updatedAt = new Date()

  if (isExhaust) {
    appendEscalationTimeline({
      em,
      scope,
      incidentId: incident.id,
      actorUserId: opts.actorUserId,
      metadata: { trigger: opts.trigger, exhausted: true, policyKey: policy.key },
      now: opts.now,
    })
    return {
      advanced: true,
      exhausted: true,
      level: expectedLevel,
      escalationStatus: 'exhausted',
      nextEscalationAt: null,
      recipients: [],
      pendingEvents: [{
        id: 'incidents.incident.escalation_exhausted',
        payload: eventPayload(scope, incident, {
          actorUserId: opts.actorUserId,
          level: expectedLevel,
          escalationStatus: 'exhausted',
          recipientUserIds: [incident.ownerUserId].filter((value): value is string => Boolean(value)),
          dedupeKey: `incidents.escalation_exhausted:${incident.id}`,
        }),
      }],
    }
  }

  appendEscalationTimeline({
    em,
    scope,
    incidentId: incident.id,
    actorUserId: opts.actorUserId,
    metadata: {
      trigger: opts.trigger,
      fromLevel: expectedLevel,
      toLevel: next.nextLevel,
      repeatsDone: incident.escalationRepeatsDone,
      policyKey: policy.key,
      recipients: recipients.map((recipient) => recipient.userId),
    },
    now: opts.now,
  })

  return {
    advanced: true,
    exhausted: false,
    level: next.nextLevel,
    escalationStatus: 'active',
    nextEscalationAt: newNextAt,
    recipients,
    pendingEvents: [{
      id: 'incidents.incident.escalated',
      payload: eventPayload(scope, incident, {
        actorUserId: opts.actorUserId,
        level: next.nextLevel,
        escalationStatus: 'active',
        recipientUserIds: recipients.map((recipient) => recipient.userId),
        dedupeKey: `incidents.escalation:${incident.id}:${next.nextLevel}:${incident.escalationRepeatsDone}`,
      }),
    }],
  }
}

export async function previewNextEscalation(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  opts: RecipientResolutionOptions = {},
): Promise<{
  nextLevel: number
  stepCount: number
  willExhaust: boolean
  targets: IncidentEscalationTarget[]
  recipients: EscalationRecipient[]
}> {
  const policy = await resolvePolicyForIncident(em, scope, incident)
  if (!policy) {
    return { nextLevel: incident.escalationLevel, stepCount: 0, willExhaust: true, targets: [], recipients: [] }
  }

  const next = incident.escalationStatus === 'inactive'
    ? { nextLevel: 0, repeatsDone: incident.escalationRepeatsDone, willExhaust: false }
    : computeNextStep(incident, policy)
  if (next.willExhaust) {
    return { nextLevel: next.nextLevel, stepCount: policy.steps.length, willExhaust: true, targets: [], recipients: [] }
  }

  const step = policyStep(policy, next.nextLevel)
  const resolved = await resolveStepRecipients(em, scope, incident, step, opts)
  return {
    nextLevel: next.nextLevel,
    stepCount: policy.steps.length,
    willExhaust: false,
    targets: resolved.targets,
    recipients: resolved.recipients,
  }
}

export function haltEscalationForAck(incident: Incident, now: Date): void {
  if (incident.escalationStatus === 'active') {
    incident.escalationStatus = 'acknowledged'
    incident.nextEscalationAt = null
    incident.updatedAt = now
  }
}

export function clearEscalationForResolveClose(incident: Incident): void {
  incident.escalationStatus = 'inactive'
  incident.nextEscalationAt = null
}

export async function applyPolicyChange(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  newPolicyId: string | null,
  opts: { actorUserId: string; now: Date; container?: OptionalResolverContainer },
): Promise<EscalationMutationResult> {
  incident.escalationPolicyId = newPolicyId

  if (newPolicyId == null) {
    incident.escalationStatus = 'inactive'
    incident.nextEscalationAt = null
    incident.updatedAt = opts.now
    return { pendingEvents: [] }
  }

  const policy = await findActivePolicy(em, scope, newPolicyId)
  if (!policy) {
    incident.escalationStatus = 'inactive'
    incident.nextEscalationAt = null
    incident.updatedAt = opts.now
    return { pendingEvents: [] }
  }

  if (incident.escalationStatus !== 'active') {
    incident.updatedAt = opts.now
    return { pendingEvents: [] }
  }

  const step = policyStep(policy, 0)
  const { recipients } = await resolveStepRecipients(em, scope, incident, step, {
    container: opts.container,
    now: opts.now,
  })
  incident.escalationLevel = 0
  incident.escalationRepeatsDone = 0
  incident.escalationStatus = 'active'
  incident.escalationLastTargets = buildLastTargets(step, recipients, opts.now)
  incident.nextEscalationAt = new Date(opts.now.getTime() + step.delayMinutes * 60_000)
  incident.updatedAt = opts.now

  appendEscalationTimeline({
    em,
    scope,
    incidentId: incident.id,
    actorUserId: opts.actorUserId,
    metadata: { trigger: 'policy_changed', policyKey: policy.key },
    now: opts.now,
  })

  return {
    pendingEvents: [{
      id: 'incidents.incident.escalation_started',
      payload: eventPayload(scope, incident, {
        actorUserId: opts.actorUserId,
        level: 0,
        escalationStatus: 'active',
        policyId: policy.id,
        recipientUserIds: recipients.map((recipient) => recipient.userId),
        // Discriminate by policy id so a mid-flight policy swap re-pages as a NEW step-0 alert
        // instead of collapsing into (refreshing) the prior policy's unread step-0 notification.
        dedupeKey: `incidents.escalation:${incident.id}:policychange:${policy.id}`,
      }),
    }],
  }
}

export async function manualEscalate(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
  opts: { actorUserId: string; now: Date; container?: OptionalResolverContainer },
): Promise<{
  escalationLevel: number
  escalationStepCount: number
  escalationStatus: string
  nextEscalationAt: Date | null
  pagedTargets: IncidentEscalationTarget[]
  recipients: EscalationRecipient[]
  pendingEvents: PendingEscalationEvent[]
}> {
  const policy = await resolvePolicyForIncident(em, scope, incident)
  if (!policy) throw new CrudHttpError(409, { error: '[internal] no_escalation_policy' })
  if (terminalIncidentStatus(incident.status)) {
    throw new CrudHttpError(409, { error: '[internal] incident is resolved or closed' })
  }
  if (incident.escalationStatus === 'exhausted') {
    throw new CrudHttpError(409, { error: '[internal] escalation_exhausted' })
  }

  let pendingEvents: PendingEscalationEvent[] = []
  let recipients: EscalationRecipient[] = []
  let trigger: AdvanceTrigger = 'manual'
  if (incident.escalationStatus === 'inactive') {
    const started = await startEscalation(em, scope, incident, opts)
    pendingEvents = started.pendingEvents
    recipients = started.recipients
  } else {
    if (incident.escalationStatus === 'acknowledged') {
      const reactivated = await reactivateAcknowledgedEscalation(em, scope, incident, opts)
      if (!reactivated) {
        return {
          escalationLevel: incident.escalationLevel,
          escalationStepCount: policy.steps.length,
          escalationStatus: incident.escalationStatus,
          nextEscalationAt: incident.nextEscalationAt ?? null,
          pagedTargets: incident.escalationLastTargets?.targets ?? [],
          recipients: [],
          pendingEvents: [],
        }
      }
      trigger = 'manual_after_ack'
    }
    const advanced = await advanceEscalation(em, scope, incident, {
      actorUserId: opts.actorUserId,
      now: opts.now,
      trigger,
      container: opts.container,
    })
    pendingEvents = advanced.pendingEvents
    recipients = advanced.recipients
  }

  return {
    escalationLevel: incident.escalationLevel,
    escalationStepCount: policy.steps.length,
    escalationStatus: incident.escalationStatus,
    nextEscalationAt: incident.nextEscalationAt ?? null,
    pagedTargets: incident.escalationLastTargets?.targets ?? [],
    recipients,
    pendingEvents,
  }
}
