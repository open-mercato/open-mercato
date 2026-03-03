import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentGovernanceDecisionEvent } from '../data/entities'
import type { DecisionTelemetryEnvelopeInput } from '../data/validators'

type TelemetryServiceDeps = {
  em: EntityManager
}

type RecordedDecision = {
  eventId: string | null
  immutableHash: string | null
  signature: string | null
  degraded: boolean
  repairRequired: boolean
}

type TelemetryDurability = 'fail_closed' | 'fail_soft'

type RecordDecisionWithDurabilityOptions = {
  durability?: TelemetryDurability
  repairCode?: string
  repairMarker?: Record<string, unknown> | null
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown_error'
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    const serialized = entries.map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`)
    return `{${serialized.join(',')}}`
  }
  return JSON.stringify(String(value))
}

export function buildDecisionSignature(input: DecisionTelemetryEnvelopeInput): string {
  const signaturePayload = {
    actionType: input.actionType,
    targetEntity: input.targetEntity,
    controlPath: input.controlPath,
    policyId: input.policyId ?? null,
    riskBandId: input.riskBandId ?? null,
  }
  return createHash('sha256').update(stableSerialize(signaturePayload)).digest('hex')
}

export function buildImmutableDecisionHash(input: DecisionTelemetryEnvelopeInput): string {
  return createHash('sha256').update(stableSerialize(input)).digest('hex')
}

export function createTelemetryService(deps: TelemetryServiceDeps) {
  async function recordDecision(input: DecisionTelemetryEnvelopeInput): Promise<RecordedDecision> {
    const now = new Date()
    const immutableHash = buildImmutableDecisionHash(input)
    const signature = input.signature ?? buildDecisionSignature(input)

    const event = deps.em.create(AgentGovernanceDecisionEvent, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      runId: input.runId ?? null,
      stepId: input.stepId ?? null,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      policyId: input.policyId ?? null,
      riskBandId: input.riskBandId ?? null,
      riskScore: input.riskScore ?? null,
      controlPath: input.controlPath,
      inputEvidence: input.sourceRefs,
      approverIds: input.approverIds,
      exceptionIds: input.exceptionIds,
      writeSet: input.writeSet ?? null,
      status: input.status,
      errorCode: input.errorCode ?? null,
      harnessProvider: input.harnessProvider ?? null,
      immutableHash,
      supersedesEventId: input.supersedesEventId ?? null,
      signature,
      createdAt: now,
    })

    deps.em.persist(event)
    await deps.em.flush()

    return {
      eventId: event.id,
      immutableHash,
      signature,
      degraded: false,
      repairRequired: false,
    }
  }

  async function recordDecisionWithDurability(
    input: DecisionTelemetryEnvelopeInput,
    options?: RecordDecisionWithDurabilityOptions,
  ): Promise<RecordedDecision> {
    const durability = options?.durability ?? 'fail_closed'
    try {
      return await recordDecision(input)
    } catch (error) {
      if (durability === 'fail_closed') {
        throw error
      }

      const repairWriteSet: Record<string, unknown> = {
        ...(input.writeSet && typeof input.writeSet === 'object' ? input.writeSet : {}),
        telemetryRepairRequired: true,
        telemetryRepairReason: toErrorMessage(error),
        ...(options?.repairMarker ?? {}),
      }

      const fallbackInput: DecisionTelemetryEnvelopeInput = {
        ...input,
        sourceRefs: [],
        status: input.status === 'success' ? 'failed' : input.status,
        errorCode: options?.repairCode ?? input.errorCode ?? 'TELEMETRY_ENRICHMENT_DEGRADED',
        writeSet: repairWriteSet,
      }

      try {
        const fallback = await recordDecision(fallbackInput)
        return {
          ...fallback,
          degraded: true,
          repairRequired: true,
        }
      } catch {
        return {
          eventId: null,
          immutableHash: null,
          signature: null,
          degraded: true,
          repairRequired: true,
        }
      }
    }
  }

  function verifyImmutableHash(event: AgentGovernanceDecisionEvent): boolean {
    const hashInput: DecisionTelemetryEnvelopeInput = {
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      runId: event.runId ?? null,
      stepId: event.stepId ?? null,
      actionType: event.actionType,
      targetEntity: event.targetEntity,
      targetId: event.targetId ?? null,
      sourceRefs: event.inputEvidence,
      policyId: event.policyId ?? null,
      riskBandId: event.riskBandId ?? null,
      riskScore: event.riskScore ?? null,
      controlPath: event.controlPath,
      approverIds: event.approverIds,
      exceptionIds: event.exceptionIds,
      writeSet: event.writeSet ?? null,
      status: event.status,
      errorCode: event.errorCode ?? null,
      harnessProvider: event.harnessProvider ?? null,
      supersedesEventId: event.supersedesEventId ?? null,
      signature: event.signature ?? null,
    }

    return buildImmutableDecisionHash(hashInput) === event.immutableHash
  }

  return {
    recordDecision,
    recordDecisionWithDurability,
    verifyImmutableHash,
  }
}

export type TelemetryService = ReturnType<typeof createTelemetryService>
