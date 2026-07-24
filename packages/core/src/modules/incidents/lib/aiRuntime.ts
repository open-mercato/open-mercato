import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { AiChatRequestContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/attachment-bridge-types'
import type {
  RunAiAgentObjectInput,
  RunAiAgentObjectResult,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'
import type { AiModelFactoryErrorCode } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import type { SearchOptions, SearchResult } from '@open-mercato/shared/modules/search'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import {
  Incident,
  IncidentImpact,
  IncidentParticipant,
  IncidentSeverity,
  IncidentTimelineEntry,
  IncidentType,
} from '../data/entities'

export type IncidentsAiRunResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable'; code?: IncidentAiUnavailableCode; error?: unknown }
  | { ok: false; reason: 'failed'; error?: unknown }

export type IncidentAiUnavailableReason = 'no_provider' | 'runtime_missing'
export type IncidentAiUnavailableCode = Extract<AiModelFactoryErrorCode, 'no_provider_configured' | 'api_key_missing'>

export type IncidentAiAvailabilityResult =
  | { available: true }
  | { available: false; reason: IncidentAiUnavailableReason }

export interface RunIncidentsObjectAgentInput {
  agentId: string
  container: AwilixContainer
  authContext: AiChatRequestContext
  input: string
}

export interface IncidentAiScope {
  tenantId: string
  organizationId: string
  organizationIds?: string[] | null
}

export interface SimilarIncident {
  id: string
  number: string
  title: string
  status: string
}

export interface IncidentCatalogEntry {
  id: string
  key: string
  label: string
  rank?: number
  isDefault?: boolean
}

export interface IncidentAiCatalogs {
  severities: IncidentCatalogEntry[]
  types: IncidentCatalogEntry[]
  priorities: IncidentCatalogEntry[]
}

export interface IncidentAiRecord {
  id: string
  number: string
  title: string
  description: string | null
  status: string
  severityId: string
  incidentTypeId: string | null
  priority: string | null
  visibility: string
  isDrill: boolean
  isMajor: boolean
  ownerUserId: string | null
  owningTeamId: string | null
  reporterUserId: string
  detectedAt: string | null
  acknowledgedAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  escalationLevel: number
  nextEscalationAt: string | null
  escalationStatus: string
  customerImpactSummary: string | null
  revenueAtRiskMinor: string | null
  revenueAtRiskCurrency: string | null
  createdAt: string
  updatedAt: string
}

export interface IncidentAiTimelineEntry {
  id: string
  incidentId: string
  kind: string
  actorUserId: string | null
  body: string | null
  visibility: string
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface IncidentAiImpact {
  id: string
  incidentId: string
  targetType: string
  targetId: string | null
  componentLabel: string | null
  impactStatus: string
  snapshot: Record<string, unknown> | null
  revenueAmountMinor: string | null
  revenueCurrency: string | null
  revenueRefreshedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IncidentAiParticipant {
  id: string
  incidentId: string
  userId: string
  kind: string
  roleId: string | null
  createdAt: string
  updatedAt: string
}

export interface IncidentAiContext {
  incident: IncidentAiRecord
  timeline: IncidentAiTimelineEntry[]
  impacts: IncidentAiImpact[]
  participants: IncidentAiParticipant[]
}

export interface LoadIncidentAiContextOptions {
  timelineLimit?: number
  timelineOrder?: 'asc' | 'desc'
}

type AiAssistantRuntimeModule = {
  runAiAgentObject: <TSchema>(
    input: RunAiAgentObjectInput<TSchema>,
  ) => Promise<RunAiAgentObjectResult<TSchema>>
  createModelFactory: (container: AwilixContainer) => {
    resolveModel: (input: { moduleId?: string }) => unknown
  }
}

type SearchServiceLike = {
  search: (query: string, options: SearchOptions) => Promise<SearchResult[]>
}

const INCIDENT_PRIORITY_CATALOG: IncidentCatalogEntry[] = [
  { id: 'low', key: 'low', label: 'Low', rank: 10 },
  { id: 'medium', key: 'medium', label: 'Medium', rank: 20, isDefault: true },
  { id: 'high', key: 'high', label: 'High', rank: 30 },
  { id: 'critical', key: 'critical', label: 'Critical', rank: 40 },
]

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasCode(value: unknown, code: string): boolean {
  const record = toRecord(value)
  return record?.code === code
}

function getFactoryUnavailableCode(error: unknown): IncidentAiUnavailableCode | null {
  if (hasCode(error, 'no_provider_configured')) return 'no_provider_configured'
  if (hasCode(error, 'api_key_missing')) return 'api_key_missing'
  return null
}

function isRuntimeMissingError(error: unknown): boolean {
  const record = toRecord(error)
  const code = typeof record?.code === 'string' ? record.code : null
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('@open-mercato/ai-assistant') && message.includes('Cannot find')
}

function isUnavailableError(error: unknown): boolean {
  if (getFactoryUnavailableCode(error)) return true
  return isRuntimeMissingError(error)
}

function getUnavailableReason(error: unknown): IncidentAiUnavailableReason | null {
  if (getFactoryUnavailableCode(error)) return 'no_provider'
  if (isRuntimeMissingError(error)) return 'runtime_missing'
  return null
}

async function loadAiAssistantRuntime(): Promise<AiAssistantRuntimeModule> {
  const [{ runAiAgentObject }, { createModelFactory }] = await Promise.all([
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-runtime'),
    import('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'),
  ])
  return {
    runAiAgentObject,
    createModelFactory,
  }
}

async function unwrapObjectResult<T>(result: RunAiAgentObjectResult<T>): Promise<T> {
  if (result.mode === 'generate') return result.object
  return result.object
}

export async function runIncidentsObjectAgent<T>(
  input: RunIncidentsObjectAgentInput,
): Promise<IncidentsAiRunResult<T>> {
  try {
    const runtime = await loadAiAssistantRuntime()
    const runtimeInput: RunAiAgentObjectInput<T> = {
      agentId: input.agentId,
      input: input.input,
      container: input.container,
      authContext: input.authContext,
    }
    const result = await runtime.runAiAgentObject<T>(runtimeInput)
    return { ok: true, data: await unwrapObjectResult(result) }
  } catch (error) {
    if (isUnavailableError(error)) {
      const code = getFactoryUnavailableCode(error) ?? undefined
      return { ok: false, reason: 'unavailable', code, error }
    }
    return { ok: false, reason: 'failed', error }
  }
}

export async function probeAiAvailability(
  container: AwilixContainer,
  authContext: AiChatRequestContext,
): Promise<IncidentAiAvailabilityResult> {
  void authContext
  try {
    const runtime = await loadAiAssistantRuntime()
    runtime.createModelFactory(container).resolveModel({ moduleId: 'incidents' })
    return { available: true }
  } catch (error) {
    const reason = getUnavailableReason(error)
    if (reason) return { available: false, reason }
    console.warn('[incidents.ai] availability probe failed', error)
    throw error
  }
}

function resolveEntityManager(container: AwilixContainer): EntityManager {
  return container.resolve<EntityManager>('em').fork()
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toRequiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

function serializeIncident(incident: Incident): IncidentAiRecord {
  return {
    id: incident.id,
    number: incident.number,
    title: incident.title,
    description: incident.description ?? null,
    status: incident.status,
    severityId: incident.severityId,
    incidentTypeId: incident.incidentTypeId ?? null,
    priority: incident.priority ?? null,
    visibility: incident.visibility,
    isDrill: incident.isDrill,
    isMajor: incident.isMajor,
    ownerUserId: incident.ownerUserId ?? null,
    owningTeamId: incident.owningTeamId ?? null,
    reporterUserId: incident.reporterUserId,
    detectedAt: toIso(incident.detectedAt),
    acknowledgedAt: toIso(incident.acknowledgedAt),
    startedAt: toIso(incident.startedAt),
    resolvedAt: toIso(incident.resolvedAt),
    closedAt: toIso(incident.closedAt),
    escalationLevel: incident.escalationLevel,
    nextEscalationAt: toIso(incident.nextEscalationAt),
    escalationStatus: incident.escalationStatus,
    customerImpactSummary: incident.customerImpactSummary ?? null,
    revenueAtRiskMinor: incident.revenueAtRiskMinor ?? null,
    revenueAtRiskCurrency: incident.revenueAtRiskCurrency ?? null,
    createdAt: toRequiredIso(incident.createdAt),
    updatedAt: toRequiredIso(incident.updatedAt),
  }
}

function serializeTimelineEntry(entry: IncidentTimelineEntry): IncidentAiTimelineEntry {
  return {
    id: entry.id,
    incidentId: entry.incidentId,
    kind: entry.kind,
    actorUserId: entry.actorUserId ?? null,
    body: entry.body ?? null,
    visibility: entry.visibility,
    metadata: entry.metadata ?? null,
    createdAt: toRequiredIso(entry.createdAt),
  }
}

function serializeImpact(impact: IncidentImpact): IncidentAiImpact {
  return {
    id: impact.id,
    incidentId: impact.incidentId,
    targetType: impact.targetType,
    targetId: impact.targetId ?? null,
    componentLabel: impact.componentLabel ?? null,
    impactStatus: impact.impactStatus,
    snapshot: impact.snapshot ?? null,
    revenueAmountMinor: impact.revenueAmountMinor ?? null,
    revenueCurrency: impact.revenueCurrency ?? null,
    revenueRefreshedAt: toIso(impact.revenueRefreshedAt),
    createdAt: toRequiredIso(impact.createdAt),
    updatedAt: toRequiredIso(impact.updatedAt),
  }
}

function serializeParticipant(participant: IncidentParticipant): IncidentAiParticipant {
  return {
    id: participant.id,
    incidentId: participant.incidentId,
    userId: participant.userId,
    kind: participant.kind,
    roleId: participant.roleId ?? null,
    createdAt: toRequiredIso(participant.createdAt),
    updatedAt: toRequiredIso(participant.updatedAt),
  }
}

function scopeWhere(scope: IncidentAiScope): Pick<IncidentAiScope, 'tenantId' | 'organizationId'> {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
}

export async function loadIncidentAiContext(
  container: AwilixContainer,
  scope: IncidentAiScope,
  id: string,
  options: LoadIncidentAiContextOptions = {},
): Promise<IncidentAiContext | null> {
  const em = resolveEntityManager(container)
  const where = {
    id,
    ...scopeWhere(scope),
    deletedAt: null,
  } satisfies FilterQuery<Incident>
  const incident = await findOneWithDecryption(em, Incident, where, undefined, scope)
  if (!incident) return null

  const timelineWhere = {
    incidentId: id,
    ...scopeWhere(scope),
  } satisfies FilterQuery<IncidentTimelineEntry>
  const timeline = await findWithDecryption(
    em,
    IncidentTimelineEntry,
    timelineWhere,
    {
      orderBy: { createdAt: options.timelineOrder ?? 'asc' },
      ...(options.timelineLimit ? { limit: options.timelineLimit } : {}),
    },
    scope,
  )

  const activeChildWhere = {
    incidentId: id,
    ...scopeWhere(scope),
    deletedAt: null,
  }
  const impacts = await findWithDecryption(
    em,
    IncidentImpact,
    activeChildWhere satisfies FilterQuery<IncidentImpact>,
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
  const participants = await findWithDecryption(
    em,
    IncidentParticipant,
    activeChildWhere satisfies FilterQuery<IncidentParticipant>,
    { orderBy: { createdAt: 'asc' } },
    scope,
  )

  return {
    incident: serializeIncident(incident),
    timeline: timeline.map(serializeTimelineEntry),
    impacts: impacts.map(serializeImpact),
    participants: participants.map(serializeParticipant),
  }
}

export async function loadIncidentCatalogs(
  container: AwilixContainer,
  scope: IncidentAiScope,
): Promise<IncidentAiCatalogs> {
  const em = resolveEntityManager(container)
  const baseWhere = {
    ...scopeWhere(scope),
    deletedAt: null,
    isActive: true,
  }
  const [severities, types] = await Promise.all([
    findWithDecryption(
      em,
      IncidentSeverity,
      baseWhere satisfies FilterQuery<IncidentSeverity>,
      { orderBy: { rank: 'asc' } },
      scope,
    ),
    findWithDecryption(
      em,
      IncidentType,
      baseWhere satisfies FilterQuery<IncidentType>,
      { orderBy: { label: 'asc' } },
      scope,
    ),
  ])
  return {
    severities: severities.map((severity) => ({
      id: severity.id,
      key: severity.key,
      label: severity.label,
      rank: severity.rank,
      isDefault: severity.isDefault,
    })),
    types: types.map((type) => ({
      id: type.id,
      key: type.key,
      label: type.label,
      isDefault: type.isDefault,
    })),
    priorities: INCIDENT_PRIORITY_CATALOG,
  }
}

export async function findSimilarIncidents(
  container: AwilixContainer,
  scope: IncidentAiScope,
  query: string,
  limit: number,
): Promise<SimilarIncident[]> {
  const text = query.trim()
  if (!text) return []
  const boundedLimit = Math.max(1, Math.min(limit, 10))

  try {
    const searchService = container.resolve<SearchServiceLike>('searchService')
    const results = await searchService.search(text, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      organizationIds: scope.organizationIds ?? [scope.organizationId],
      entityTypes: [E.incidents.incident],
      limit: boundedLimit,
    })
    const ids = results
      .filter((result) => result.entityId === E.incidents.incident)
      .map((result) => result.recordId)
      .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index)
      .slice(0, boundedLimit)
    if (!ids.length) return []

    const em = resolveEntityManager(container)
    const incidents = await findWithDecryption(
      em,
      Incident,
      {
        id: { $in: ids },
        ...scopeWhere(scope),
        deletedAt: null,
      } satisfies FilterQuery<Incident>,
      undefined,
      scope,
    )
    const byId = new Map(incidents.map((incident) => [incident.id, incident]))
    return ids
      .map((id) => byId.get(id))
      .filter((incident): incident is Incident => !!incident)
      .map((incident) => ({
        id: incident.id,
        number: incident.number,
        title: incident.title,
        status: incident.status,
      }))
  } catch (error) {
    console.warn('[incidents.ai] similar incidents search failed', error)
    return []
  }
}
