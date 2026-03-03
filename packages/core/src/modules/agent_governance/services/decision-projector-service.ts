import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGovernanceDecisionEntityLink,
  AgentGovernanceDecisionEvent,
  AgentGovernanceDecisionWhyLink,
  AgentGovernancePrecedentIndex,
} from '../data/entities'

type DecisionProjectorDeps = {
  em: EntityManager
}

export type DecisionProjectionRequest = {
  eventId: string
  tenantId?: string | null
  organizationId?: string | null
}

export type DecisionProjectionResult = {
  projected: boolean
  skipped: boolean
  eventId: string | null
  checksum: string | null
  entityLinks: number
  whyLinks: number
}

type ProjectedEntityLink = {
  entityType: string
  entityId: string
  relationshipType: string
}

type ProjectedWhyLink = {
  reasonType: 'policy' | 'precedent' | 'exception' | 'human_override' | 'other'
  refId?: string | null
  summary?: string | null
  confidence?: number | null
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function parseEntityRef(ref: string): { entityType: string; entityId: string } {
  const trimmed = ref.trim()
  if (!trimmed) {
    return { entityType: 'agent_governance:source_ref', entityId: ref }
  }

  const separatorIndex = trimmed.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return { entityType: 'agent_governance:source_ref', entityId: trimmed }
  }

  return {
    entityType: trimmed.slice(0, separatorIndex),
    entityId: trimmed.slice(separatorIndex + 1),
  }
}

export function buildProjectedEntityLinks(event: AgentGovernanceDecisionEvent): ProjectedEntityLink[] {
  const links: ProjectedEntityLink[] = []

  if (event.targetId) {
    links.push({
      entityType: event.targetEntity,
      entityId: event.targetId,
      relationshipType: 'target',
    })
  }

  for (const ref of event.inputEvidence ?? []) {
    if (!ref) continue
    const parsedRef = parseEntityRef(ref)
    links.push({
      entityType: parsedRef.entityType,
      entityId: parsedRef.entityId,
      relationshipType: 'evidence',
    })
  }

  for (const approverId of event.approverIds ?? []) {
    if (!approverId) continue
    links.push({
      entityType: 'auth:user',
      entityId: approverId,
      relationshipType: 'approval_subject',
    })
  }

  for (const exceptionId of event.exceptionIds ?? []) {
    if (!exceptionId) continue
    links.push({
      entityType: 'agent_governance:exception',
      entityId: exceptionId,
      relationshipType: 'exception',
    })
  }

  const unique = new Map<string, ProjectedEntityLink>()
  for (const link of links) {
    unique.set(`${link.relationshipType}|${link.entityType}|${link.entityId}`, link)
  }

  return [...unique.values()]
}

export function buildProjectedWhyLinks(event: AgentGovernanceDecisionEvent): ProjectedWhyLink[] {
  const links: ProjectedWhyLink[] = []
  const writeSet =
    event.writeSet && typeof event.writeSet === 'object'
      ? (event.writeSet as Record<string, unknown>)
      : null

  if (event.policyId) {
    links.push({
      reasonType: 'policy',
      refId: event.policyId,
      summary: 'Policy-selected governance path.',
      confidence: 1,
    })
  }

  if (event.riskBandId) {
    links.push({
      reasonType: 'other',
      refId: event.riskBandId,
      summary: 'Risk-band constraints applied.',
      confidence: 0.95,
    })
  }

  if (event.supersedesEventId) {
    links.push({
      reasonType: 'precedent',
      refId: event.supersedesEventId,
      summary: 'Superseded previous decision event.',
      confidence: 0.9,
    })
  }

  for (const exceptionId of event.exceptionIds ?? []) {
    if (!exceptionId) continue
    links.push({
      reasonType: 'exception',
      refId: exceptionId,
      summary: 'Exception pathway applied.',
      confidence: 0.85,
    })
  }

  if (event.controlPath === 'override' && (event.approverIds?.length ?? 0) > 0) {
    links.push({
      reasonType: 'human_override',
      refId: event.approverIds[0] ?? null,
      summary: 'Operator override confirmed.',
      confidence: 0.9,
    })
  }

  const contextSliceRefs = Array.isArray(writeSet?.contextSliceRefs)
    ? writeSet.contextSliceRefs.filter((value): value is string => typeof value === 'string')
    : []

  for (const sourceRef of contextSliceRefs) {
    if (sourceRef.startsWith('decision_event:')) {
      links.push({
        reasonType: 'precedent',
        refId: sourceRef.slice('decision_event:'.length),
        summary: 'Retrieved precedent slice attached to decision.',
        confidence: 0.8,
      })
      continue
    }

    links.push({
      reasonType: 'other',
      refId: sourceRef,
      summary: 'Retrieved context slice attached to decision.',
      confidence: 0.7,
    })
  }

  if (typeof writeSet?.retrievalBundleId === 'string') {
    links.push({
      reasonType: 'other',
      refId: writeSet.retrievalBundleId,
      summary: 'Retrieval context bundle linked to decision trace.',
      confidence: 0.75,
    })
  }

  const unique = new Map<string, ProjectedWhyLink>()
  for (const link of links) {
    unique.set(
      `${link.reasonType}|${link.refId ?? ''}|${link.summary ?? ''}`,
      link,
    )
  }

  return [...unique.values()]
}

function toScore(event: AgentGovernanceDecisionEvent): number {
  let score = 0.3

  if (event.status === 'success') score += 0.4
  if (event.status === 'blocked') score += 0.1

  if (event.controlPath === 'auto') score += 0.15
  if (event.controlPath === 'checkpoint') score += 0.1
  if (event.controlPath === 'override') score += 0.05

  if (typeof event.riskScore === 'number') {
    const boundedRisk = Math.max(0, Math.min(100, event.riskScore))
    score += (100 - boundedRisk) / 1000
  }

  return Math.round(Math.max(0, Math.min(1, score)) * 1000) / 1000
}

function toSummary(event: AgentGovernanceDecisionEvent): string {
  const parts: string[] = []

  parts.push(`Action ${event.actionType}`)
  parts.push(`Target ${event.targetEntity}${event.targetId ? `:${event.targetId}` : ''}`)
  parts.push(`Status ${event.status}`)
  parts.push(`Path ${event.controlPath}`)

  if (event.errorCode) {
    parts.push(`Error ${event.errorCode}`)
  }

  if (event.policyId) {
    parts.push(`Policy ${event.policyId}`)
  }

  if (event.riskBandId) {
    parts.push(`RiskBand ${event.riskBandId}`)
  }

  return parts.join(' | ')
}

export function buildPrecedentChecksum(
  event: AgentGovernanceDecisionEvent,
  entityLinks: ProjectedEntityLink[],
  whyLinks: ProjectedWhyLink[],
): string {
  const payload = {
    id: event.id,
    actionType: event.actionType,
    targetEntity: event.targetEntity,
    targetId: event.targetId ?? null,
    policyId: event.policyId ?? null,
    riskBandId: event.riskBandId ?? null,
    riskScore: event.riskScore ?? null,
    controlPath: event.controlPath,
    status: event.status,
    errorCode: event.errorCode ?? null,
    signature: event.signature ?? null,
    immutableHash: event.immutableHash,
    supersedesEventId: event.supersedesEventId ?? null,
    writeSet: event.writeSet ?? null,
    entityLinks,
    whyLinks,
  }

  return createHash('sha256').update(stableSerialize(payload)).digest('hex')
}

export function createDecisionProjectorService(deps: DecisionProjectorDeps) {
  async function projectDecisionEvent(input: DecisionProjectionRequest): Promise<DecisionProjectionResult> {
    const where: Record<string, unknown> = {
      id: input.eventId,
    }

    if (input.tenantId) {
      where.tenantId = input.tenantId
    }

    if (input.organizationId) {
      where.organizationId = input.organizationId
    }

    const event = await findOneWithDecryption(
      deps.em,
      AgentGovernanceDecisionEvent,
      where,
      undefined,
      {
        tenantId: input.tenantId ?? null,
        organizationId: input.organizationId ?? null,
      },
    )

    if (!event) {
      return {
        projected: false,
        skipped: true,
        eventId: null,
        checksum: null,
        entityLinks: 0,
        whyLinks: 0,
      }
    }

    const entityLinks = buildProjectedEntityLinks(event)
    const whyLinks = buildProjectedWhyLinks(event)
    const checksum = buildPrecedentChecksum(event, entityLinks, whyLinks)

    const existingIndex = await findOneWithDecryption(
      deps.em,
      AgentGovernancePrecedentIndex,
      {
        tenantId: event.tenantId,
        organizationId: event.organizationId,
        decisionEventId: event.id,
      },
      undefined,
      { tenantId: event.tenantId, organizationId: event.organizationId },
    )

    if (existingIndex?.checksum === checksum) {
      return {
        projected: false,
        skipped: true,
        eventId: event.id,
        checksum,
        entityLinks: 0,
        whyLinks: 0,
      }
    }

    await deps.em.nativeDelete(AgentGovernanceDecisionEntityLink, {
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      decisionEvent: event.id,
    })

    await deps.em.nativeDelete(AgentGovernanceDecisionWhyLink, {
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      decisionEvent: event.id,
    })

    const now = new Date()

    for (const link of entityLinks) {
      deps.em.persist(
        deps.em.create(AgentGovernanceDecisionEntityLink, {
          tenantId: event.tenantId,
          organizationId: event.organizationId,
          decisionEvent: event,
          entityType: link.entityType,
          entityId: link.entityId,
          relationshipType: link.relationshipType,
          createdAt: now,
        }),
      )
    }

    for (const link of whyLinks) {
      deps.em.persist(
        deps.em.create(AgentGovernanceDecisionWhyLink, {
          tenantId: event.tenantId,
          organizationId: event.organizationId,
          decisionEvent: event,
          reasonType: link.reasonType,
          refId: link.refId ?? null,
          summary: link.summary ?? null,
          confidence: link.confidence ?? null,
          createdAt: now,
        }),
      )
    }

    const signature = event.signature ?? event.immutableHash
    const summary = toSummary(event)
    const score = toScore(event)

    if (existingIndex) {
      existingIndex.signature = signature
      existingIndex.summary = summary
      existingIndex.score = score
      existingIndex.checksum = checksum
      existingIndex.updatedAt = now
      deps.em.persist(existingIndex)
    } else {
      deps.em.persist(
        deps.em.create(AgentGovernancePrecedentIndex, {
          tenantId: event.tenantId,
          organizationId: event.organizationId,
          decisionEventId: event.id,
          signature,
          summary,
          score,
          checksum,
          createdAt: now,
          updatedAt: now,
        }),
      )
    }

    await deps.em.flush()

    return {
      projected: true,
      skipped: false,
      eventId: event.id,
      checksum,
      entityLinks: entityLinks.length,
      whyLinks: whyLinks.length,
    }
  }

  return {
    projectDecisionEvent,
  }
}

export type DecisionProjectorService = ReturnType<typeof createDecisionProjectorService>
