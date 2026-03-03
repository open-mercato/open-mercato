import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGovernanceDecisionEvent,
  AgentGovernanceSkill,
  type AgentSkillSourceType,
} from '../data/entities'

type Scope = {
  tenantId: string
  organizationId: string
}

type CaptureCandidateInput = Scope & {
  decisionEventIds?: string[]
  actionType?: string | null
  targetEntity?: string | null
  targetId?: string | null
  suggestedName?: string | null
  suggestedDescription?: string | null
  postmortem?: string | null
  sampleSize?: number
}

type SkillValidationInput = Scope & {
  skill: AgentGovernanceSkill
  sampleSize?: number
  passRateThreshold?: number
}

export type SkillValidationReport = {
  sampledEvents: number
  matchedEvents: number
  passRate: number
  threshold: number
  passed: boolean
  requiredPolicyIds: string[]
  requiredContextPrefixes: string[]
  sampledEventIds: string[]
  failedChecks: string[]
}

export type SkillGuidanceItem = {
  skillId: string
  name: string
  summary: string
  confidence: number
  sourceRef: string
}

type GuidanceInput = Scope & {
  actionType?: string | null
  targetEntity?: string | null
  targetId?: string | null
  limit?: number
}

type PlaybookDraftInput = Scope & {
  actionType: string
  targetEntity: string
  targetId?: string | null
  playbookName?: string | null
}

function normalizePrefix(ref: string): string {
  const parts = ref.split(':')
  return parts[0]?.trim().toLowerCase() || 'context'
}

function collectTopValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    const normalized = value.trim()
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value)
}

function readFrameworkIntent(skill: AgentGovernanceSkill): { actionType?: string; targetEntity?: string; targetId?: string } {
  const framework = skill.frameworkJson
  if (!framework || typeof framework !== 'object') {
    return {}
  }

  const intent = framework.intent
  if (!intent || typeof intent !== 'object') {
    return {}
  }

  const typedIntent = intent as Record<string, unknown>

  return {
    actionType: typeof typedIntent.actionType === 'string' ? typedIntent.actionType : undefined,
    targetEntity: typeof typedIntent.targetEntity === 'string' ? typedIntent.targetEntity : undefined,
    targetId: typeof typedIntent.targetId === 'string' ? typedIntent.targetId : undefined,
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function parseValidationConfidence(skill: AgentGovernanceSkill): number {
  const framework = skill.frameworkJson
  if (!framework || typeof framework !== 'object') return 0.6
  const validation = (framework as Record<string, unknown>).validation
  if (!validation || typeof validation !== 'object') return 0.6
  const passRate = (validation as Record<string, unknown>).passRate
  if (typeof passRate !== 'number') return 0.6
  return Math.max(0, Math.min(1, passRate))
}

function buildSkillName(actionType: string | null | undefined, targetEntity: string | null | undefined): string {
  const action = actionType?.trim() || 'decision'
  const entity = targetEntity?.trim() || 'workflow'
  return `${action}:${entity}`
}

function buildSkillSummary(skill: AgentGovernanceSkill): string {
  if (typeof skill.description === 'string' && skill.description.trim().length > 0) {
    return skill.description.trim()
  }

  const framework = skill.frameworkJson
  if (!framework || typeof framework !== 'object') {
    return 'Reusable organizational decision skill'
  }

  const reasoning = (framework as Record<string, unknown>).reasoningFramework
  if (!reasoning || typeof reasoning !== 'object') {
    return 'Reusable organizational decision skill'
  }

  const summary = (reasoning as Record<string, unknown>).summary
  if (typeof summary === 'string' && summary.trim().length > 0) {
    return summary.trim()
  }

  return 'Reusable organizational decision skill'
}

function parseRequiredPolicyIds(skill: AgentGovernanceSkill): string[] {
  const framework = skill.frameworkJson
  if (!framework || typeof framework !== 'object') return []
  const checks = (framework as Record<string, unknown>).policyChecks
  if (!Array.isArray(checks)) return []

  const policyIds: string[] = []
  for (const check of checks) {
    if (!check || typeof check !== 'object') continue
    const id = (check as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim().length > 0) {
      policyIds.push(id)
    }
  }

  return policyIds
}

function parseRequiredContextPrefixes(skill: AgentGovernanceSkill): string[] {
  const framework = skill.frameworkJson
  if (!framework || typeof framework !== 'object') return []
  const requirements = (framework as Record<string, unknown>).contextRequirements
  return collectTopValues(readStringArray(requirements), 10)
}

export function createSkillLifecycleService(deps: { em: EntityManager }) {
  async function loadTraceEvents(input: CaptureCandidateInput): Promise<AgentGovernanceDecisionEvent[]> {
    const baseFilter: Record<string, unknown> = {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    }

    if (Array.isArray(input.decisionEventIds) && input.decisionEventIds.length > 0) {
      baseFilter.id = { $in: input.decisionEventIds }
      return findWithDecryption(
        deps.em,
        AgentGovernanceDecisionEvent,
        baseFilter,
        {
          orderBy: { createdAt: 'DESC' },
          limit: Math.min(Math.max(input.sampleSize ?? input.decisionEventIds.length, 1), 250),
        },
        {
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        },
      )
    }

    if (input.actionType) {
      baseFilter.actionType = input.actionType
    }
    if (input.targetEntity) {
      baseFilter.targetEntity = input.targetEntity
    }
    if (input.targetId) {
      baseFilter.targetId = input.targetId
    }

    return findWithDecryption(
      deps.em,
      AgentGovernanceDecisionEvent,
      baseFilter,
      {
        orderBy: { createdAt: 'DESC' },
        limit: Math.min(Math.max(input.sampleSize ?? 60, 1), 250),
      },
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
    )
  }

  async function captureCandidateFromTraces(input: CaptureCandidateInput): Promise<{
    name: string
    description: string
    sourceType: AgentSkillSourceType
    frameworkJson: Record<string, unknown>
    evidenceEventIds: string[]
  }> {
    const events = await loadTraceEvents(input)

    const evidenceEventIds = collectTopValues(events.map((event) => event.id), 250)
    const actionTypes = collectTopValues(events.map((event) => event.actionType), 3)
    const targetEntities = collectTopValues(events.map((event) => event.targetEntity), 3)
    const contextPrefixes = collectTopValues(
      events.flatMap((event) => event.inputEvidence ?? []).map((ref) => normalizePrefix(ref)),
      12,
    )
    const policyIds = collectTopValues(events.map((event) => event.policyId ?? '').filter((value) => value.length > 0), 8)
    const riskBandIds = collectTopValues(events.map((event) => event.riskBandId ?? '').filter((value) => value.length > 0), 8)
    const frequentExceptions = collectTopValues(events.flatMap((event) => event.exceptionIds ?? []), 8)

    const successfulEvents = events.filter((event) => event.status === 'success').length
    const failedEvents = events.length - successfulEvents
    const successRate = events.length > 0 ? successfulEvents / events.length : 0

    const canonicalActionType = input.actionType ?? actionTypes[0] ?? null
    const canonicalTargetEntity = input.targetEntity ?? targetEntities[0] ?? null

    const name = input.suggestedName?.trim() || buildSkillName(canonicalActionType, canonicalTargetEntity)

    const description = input.suggestedDescription?.trim() ||
      `Extracted from ${events.length} decision traces (${Math.round(successRate * 100)}% success).`

    const frameworkJson: Record<string, unknown> = {
      intent: {
        actionType: canonicalActionType,
        targetEntity: canonicalTargetEntity,
        targetId: input.targetId ?? null,
      },
      contextRequirements: contextPrefixes,
      policyChecks: policyIds.map((id) => ({ id })),
      riskSignals: {
        riskBandIds,
      },
      reasoningFramework: {
        summary: `Use precedent-first reasoning for ${canonicalActionType ?? 'decision'} on ${canonicalTargetEntity ?? 'entity'}.`,
        steps: [
          'Gather required context slices before action.',
          'Validate policy and risk constraints against current run inputs.',
          'Search precedents and compare current case to known exceptions.',
          'Escalate when confidence is low or exceptions are unresolved.',
        ],
      },
      escalationConditions: [
        'No matching precedent confidence above threshold.',
        'Required policy checks are missing in current context.',
        'High-risk action without explicit approval path.',
      ],
      edgeCases: [
        ...(failedEvents > 0 ? [`${failedEvents} failures in source traces require manual review.`] : []),
        ...(frequentExceptions.length > 0 ? [`Frequent exceptions: ${frequentExceptions.join(', ')}`] : []),
      ],
      successCriteria: [
        'Decision trace persisted with complete evidence refs.',
        'Policy and risk links attached to committed decision.',
        'Approval checkpoints honored for guarded actions.',
      ],
      source: {
        evidenceEventIds,
        totalEvents: events.length,
        successRate,
        capturedAt: new Date().toISOString(),
      },
      postmortem: input.postmortem ?? null,
    }

    const sourceType: AgentSkillSourceType = input.postmortem ? 'hybrid' : 'trace_mining'

    return {
      name,
      description,
      sourceType,
      frameworkJson,
      evidenceEventIds,
    }
  }

  async function validateSkillDefinition(input: SkillValidationInput): Promise<SkillValidationReport> {
    const intent = readFrameworkIntent(input.skill)

    const events = await loadTraceEvents({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      actionType: intent.actionType ?? null,
      targetEntity: intent.targetEntity ?? null,
      targetId: intent.targetId ?? null,
      sampleSize: input.sampleSize,
    })

    const requiredPolicyIds = parseRequiredPolicyIds(input.skill)
    const requiredContextPrefixes = parseRequiredContextPrefixes(input.skill)

    const failedChecks: string[] = []
    let matchedEvents = 0

    for (const event of events) {
      let matches = true

      if (requiredPolicyIds.length > 0 && (!event.policyId || !requiredPolicyIds.includes(event.policyId))) {
        matches = false
      }

      if (matches && requiredContextPrefixes.length > 0) {
        const seenPrefixes = new Set((event.inputEvidence ?? []).map((ref) => normalizePrefix(ref)))
        for (const prefix of requiredContextPrefixes) {
          if (!seenPrefixes.has(prefix)) {
            matches = false
            break
          }
        }
      }

      if (matches && event.status !== 'success') {
        matches = false
      }

      if (matches) {
        matchedEvents += 1
      }
    }

    const sampledEvents = events.length
    const passRate = sampledEvents > 0 ? matchedEvents / sampledEvents : 0
    const threshold = Math.max(0, Math.min(1, input.passRateThreshold ?? 0.6))
    const passed = sampledEvents > 0 && passRate >= threshold

    if (!sampledEvents) {
      failedChecks.push('No matching historical traces found for validation sample.')
    }

    if (!passed) {
      failedChecks.push(`Pass rate ${passRate.toFixed(2)} below threshold ${threshold.toFixed(2)}.`)
    }

    return {
      sampledEvents,
      matchedEvents,
      passRate,
      threshold,
      passed,
      requiredPolicyIds,
      requiredContextPrefixes,
      sampledEventIds: events.map((event) => event.id),
      failedChecks,
    }
  }

  async function listActiveGuidance(input: GuidanceInput): Promise<SkillGuidanceItem[]> {
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 30)

    const skills = await findWithDecryption(
      deps.em,
      AgentGovernanceSkill,
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        status: 'active',
        deletedAt: null,
      },
      {
        orderBy: { updatedAt: 'DESC' },
        limit: 120,
      },
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
    )

    const ranked = skills
      .map((skill) => {
        const intent = readFrameworkIntent(skill)

        let score = 0
        if (input.actionType && intent.actionType === input.actionType) score += 0.5
        if (input.targetEntity && intent.targetEntity === input.targetEntity) score += 0.35
        if (input.targetId && intent.targetId === input.targetId) score += 0.15
        if (!input.actionType && !input.targetEntity) score += 0.2

        return {
          skill,
          score,
        }
      })
      .filter(({ score }) => score > 0 || (!input.actionType && !input.targetEntity))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return ranked.map(({ skill, score }) => {
      const confidence = Math.max(parseValidationConfidence(skill), score)
      return {
        skillId: skill.id,
        name: skill.name,
        summary: buildSkillSummary(skill),
        confidence,
        sourceRef: `skill:${skill.id}`,
      }
    })
  }

  async function buildPlaybookDraft(input: PlaybookDraftInput): Promise<{
    name: string
    description: string
    actionType: string
    targetEntity: string
    targetId: string | null
    recommendedPolicyId: string | null
    recommendedRiskBandId: string | null
    suggestedGuidance: SkillGuidanceItem[]
  }> {
    const suggestedGuidance = await listActiveGuidance({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      limit: 6,
    })

    const relatedSkills = await findWithDecryption(
      deps.em,
      AgentGovernanceSkill,
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        id: { $in: suggestedGuidance.map((item) => item.skillId) },
      },
      {},
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
    )

    const recommendedPolicyId = collectTopValues(
      relatedSkills.flatMap((skill) => parseRequiredPolicyIds(skill)),
      1,
    )[0] ?? null

    const recommendedRiskBandId = collectTopValues(
      relatedSkills
        .map((skill) => {
          const framework = skill.frameworkJson
          if (!framework || typeof framework !== 'object') return null
          const riskSignals = (framework as Record<string, unknown>).riskSignals
          if (!riskSignals || typeof riskSignals !== 'object') return null
          const ids = readStringArray((riskSignals as Record<string, unknown>).riskBandIds)
          return ids[0] ?? null
        })
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
      1,
    )[0] ?? null

    const defaultName = `${input.actionType}:${input.targetEntity}`

    return {
      name: input.playbookName?.trim() || defaultName,
      description: `Generated from ${suggestedGuidance.length} active governance skill(s).`,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      recommendedPolicyId,
      recommendedRiskBandId,
      suggestedGuidance,
    }
  }

  return {
    captureCandidateFromTraces,
    validateSkillDefinition,
    listActiveGuidance,
    buildPlaybookDraft,
  }
}

export type SkillLifecycleService = ReturnType<typeof createSkillLifecycleService>
