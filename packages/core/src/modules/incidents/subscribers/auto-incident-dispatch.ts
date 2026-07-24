import { incidentFind, incidentFindOne } from '../lib/read'
import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { SubscriberContext } from '@open-mercato/events/types'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import {
  IncidentEscalationPolicy,
  IncidentSeverity,
  IncidentTrigger,
  IncidentType,
  type IncidentTriggerCondition,
} from '../data/entities'
import type { IncidentCreateInput } from '../data/validators'
import type { IncidentCommandResult } from '../commands/incident'

const SOURCE_EVENT_REF_UNIQUE_INDEX = 'incidents_org_tenant_source_event_ref_unique'
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
const SKIPPED_PREFIXES = ['incidents.', 'application.', 'query_index.', 'webhooks.'] as const
const STABLE_ID_FIELDS = ['id', 'recordId', 'entityId'] as const
const HASH_EXCLUDED_KEYS = new Set(['tenantId', 'tenant_id', 'organizationId', 'organization_id', 'eventId', 'event_id', 'type'])
const VOLATILE_HASH_KEY_PATTERN = /(^|_)(at|time|timestamp|date)s?$/i

export const metadata = {
  event: '*',
  persistent: true,
  id: 'incidents:auto-incident-dispatch',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type DispatchContext =
  | (SubscriberContext & { eventId?: string; eventName?: string })
  | {
    container?: { resolve: <T = unknown>(name: string) => T }
    eventId?: string
    eventName?: string
    resolve?: <T = unknown>(name: string) => T
  }

type IncidentScope = {
  organizationId: string
  tenantId: string
}

type SourceEventRefResult = {
  sourceEventRef: string | null
  displayRef: string | null
}

type ResolvedCatalog = {
  severity: IncidentSeverity
  incidentType: IncidentType | null
  escalationPolicyId: string | null
}

function buildCommandContext(ctx: ResolverContext, scope: IncidentScope): CommandRuntimeContext {
  return {
    container: ctx as unknown as AwilixContainer,
    auth: {
      sub: SYSTEM_USER_ID,
      userId: SYSTEM_USER_ID,
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      features: [],
    },
    organizationScope: {
      selectedId: scope.organizationId,
      filterIds: [scope.organizationId],
      allowedIds: [scope.organizationId],
      tenantId: scope.tenantId,
    },
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function resolveEventId(payload: Record<string, unknown>, ctx: DispatchContext): string | null {
  return text(ctx.eventId) ?? text(ctx.eventName) ?? text(payload.eventId) ?? text(payload.type)
}

function resolveDependency(ctx: DispatchContext): ResolverContext | null {
  if ('resolve' in ctx && typeof ctx.resolve === 'function') return { resolve: ctx.resolve }
  if ('container' in ctx && ctx.container && typeof ctx.container.resolve === 'function') {
    return { resolve: ctx.container.resolve.bind(ctx.container) }
  }
  return null
}

function shouldSkipEvent(eventId: string): boolean {
  if (SKIPPED_PREFIXES.some((prefix) => eventId.startsWith(prefix))) return true
  const declaredEvent = getDeclaredEvents().find((event) => event.id === eventId)
  return declaredEvent?.excludeFromTriggers === true
}

function eventLabel(eventId: string): string {
  return getDeclaredEvents().find((event) => event.id === eventId)?.label ?? eventId
}

function forkIncidentEntityManager(em: EntityManager): EntityManager {
  const fork = (em as unknown as { fork?: (options?: Record<string, unknown>) => EntityManager }).fork
  if (typeof fork !== 'function') return em
  return fork.call(em, { clear: true, useContext: false })
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function normalizeHashKey(key: string): string {
  return key.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`)
}

function shouldExcludeFromHash(key: string): boolean {
  return HASH_EXCLUDED_KEYS.has(key) || VOLATILE_HASH_KEY_PATTERN.test(normalizeHashKey(key))
}

function buildScalarHash(payload: Record<string, unknown>): string | null {
  const entries = Object.entries(payload)
    .filter(([key, value]) => !shouldExcludeFromHash(key) && isScalar(value))
    .sort(([left], [right]) => left.localeCompare(right))
  if (!entries.length) return null
  const projection = Object.fromEntries(entries)
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex')
}

function buildSourceEventRef(eventId: string, payload: Record<string, unknown>): SourceEventRefResult {
  for (const field of STABLE_ID_FIELDS) {
    const stableId = text(payload[field])
    if (stableId) return { sourceEventRef: `${eventId}:${stableId}`, displayRef: stableId }
  }
  const hash = buildScalarHash(payload)
  if (!hash) return { sourceEventRef: null, displayRef: null }
  return { sourceEventRef: `${eventId}:${hash}`, displayRef: hash }
}

function readDotPath(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload
  for (const segment of path.split('.')) {
    if (!segment || !current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function matchesCondition(payload: Record<string, unknown>, condition: IncidentTriggerCondition): boolean {
  const value = readDotPath(payload, condition.path)
  return isScalar(value) && value === condition.equals
}

function matchesConditions(payload: Record<string, unknown>, conditions: IncidentTriggerCondition[] | null | undefined): boolean {
  if (!conditions?.length) return true
  return conditions.every((condition) => matchesCondition(payload, condition))
}

async function resolveSeverity(
  em: EntityManager,
  scope: IncidentScope,
  severityKey: string | null | undefined,
): Promise<IncidentSeverity | null> {
  if (severityKey) {
    const configured = await incidentFindOne(em, IncidentSeverity, {
      ...scope,
      key: severityKey,
      deletedAt: null,
      isActive: true,
    })
    if (configured) return configured
  }
  return (
    await incidentFindOne(em, IncidentSeverity, { ...scope, isDefault: true, deletedAt: null, isActive: true }) ??
    await incidentFindOne(em, IncidentSeverity, { ...scope, deletedAt: null, isActive: true }, { orderBy: { rank: 'asc' } })
  )
}

async function resolveIncidentType(
  em: EntityManager,
  scope: IncidentScope,
  typeKey: string | null | undefined,
): Promise<IncidentType | null> {
  if (typeKey) {
    const configured = await incidentFindOne(em, IncidentType, {
      ...scope,
      key: typeKey,
      deletedAt: null,
      isActive: true,
    })
    if (configured) return configured
  }
  return (
    await incidentFindOne(em, IncidentType, { ...scope, isDefault: true, deletedAt: null, isActive: true }) ??
    await incidentFindOne(em, IncidentType, { ...scope, deletedAt: null, isActive: true }, { orderBy: { key: 'asc' } })
  )
}

async function resolveEscalationPolicyId(
  em: EntityManager,
  scope: IncidentScope,
  trigger: IncidentTrigger,
): Promise<string | null> {
  if (trigger.escalationPolicyId) {
    const configured = await incidentFindOne(em, IncidentEscalationPolicy, {
      id: trigger.escalationPolicyId,
      ...scope,
      deletedAt: null,
      isActive: true,
    })
    if (configured) return configured.id
  }
  return null
}

async function resolveCatalog(
  em: EntityManager,
  scope: IncidentScope,
  trigger: IncidentTrigger,
): Promise<ResolvedCatalog | null> {
  const severity = await resolveSeverity(em, scope, trigger.severityKey)
  if (!severity) {
    console.warn('[incidents:auto-incident-dispatch] no active severity found for trigger', {
      triggerId: trigger.id,
      eventId: trigger.eventId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return null
  }
  const incidentType = await resolveIncidentType(em, scope, trigger.typeKey)
  const escalationPolicyId = await resolveEscalationPolicyId(em, scope, trigger)
  return { severity, incidentType, escalationPolicyId }
}

function buildTitle(eventId: string, displayRef: string | null): string {
  const label = eventLabel(eventId)
  return displayRef ? `${label}: ${displayRef}` : label
}

async function dispatchIncidentCreate(
  commandBus: CommandBus,
  commandContext: CommandRuntimeContext,
  input: IncidentCreateInput,
): Promise<IncidentCommandResult | null> {
  const { result } = await commandBus.execute<IncidentCreateInput, IncidentCommandResult>(
    'incidents.incident.create',
    { input, ctx: commandContext },
  )
  return result ?? null
}

async function processTrigger(opts: {
  trigger: IncidentTrigger
  payload: Record<string, unknown>
  eventId: string
  scope: IncidentScope
  em: EntityManager
  commandBus: CommandBus
  commandContext: CommandRuntimeContext
}): Promise<void> {
  const { trigger, payload, eventId, scope, em, commandBus, commandContext } = opts
  if (!trigger.isEnabled) return
  if (!matchesConditions(payload, trigger.conditions)) return
  const catalog = await resolveCatalog(em, scope, trigger)
  if (!catalog) return

  const { sourceEventRef, displayRef } = buildSourceEventRef(eventId, payload)
  if (!sourceEventRef) {
    console.warn('[incidents:auto-incident-dispatch] source event has no stable dedupe key', {
      eventId,
      triggerId: trigger.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  }

  const input: IncidentCreateInput = {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    title: buildTitle(eventId, displayRef),
    description: null,
    incidentTypeId: catalog.incidentType?.id ?? null,
    severityId: catalog.severity.id,
    priority: null,
    customerImpactSummary: null,
    sourceEventRef,
    ...(catalog.escalationPolicyId ? { escalationPolicyId: catalog.escalationPolicyId } : {}),
  }

  try {
    await dispatchIncidentCreate(commandBus, commandContext, input)
  } catch (error) {
    if (sourceEventRef && isUniqueViolation(error, SOURCE_EVENT_REF_UNIQUE_INDEX)) {
      console.warn('[incidents:auto-incident-dispatch] incident already created by another delivery', {
        eventId,
        triggerId: trigger.id,
        sourceEventRef,
      })
      return
    }
    throw error
  }
}

export default async function handle(
  payload: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<void> {
  const eventId = resolveEventId(payload, ctx)
  if (!eventId) return
  if (shouldSkipEvent(eventId)) return

  const tenantId = text(payload.tenantId)
  const organizationId = text(payload.organizationId)
  if (!tenantId || !organizationId) return

  const resolver = resolveDependency(ctx)
  if (!resolver) return

  const scope = { tenantId, organizationId }
  let em: EntityManager
  let triggers: IncidentTrigger[]
  let commandBus: CommandBus
  let commandContext: CommandRuntimeContext
  try {
    em = forkIncidentEntityManager(resolver.resolve<EntityManager>('em'))
    triggers = await incidentFind(em, IncidentTrigger, {
      ...scope,
      eventId,
      isEnabled: true,
      deletedAt: null,
    })
    if (!triggers.length) return
    commandBus = resolver.resolve<CommandBus>('commandBus')
    commandContext = buildCommandContext(resolver, scope)
  } catch (error) {
    console.error('[incidents:auto-incident-dispatch] dispatch setup failed', { eventId, tenantId, organizationId, error })
    return
  }
  for (const trigger of triggers) {
    try {
      await processTrigger({ trigger, payload, eventId, scope, em, commandBus, commandContext })
    } catch (error) {
      console.error('[incidents:auto-incident-dispatch] trigger dispatch failed', {
        eventId,
        triggerId: trigger.id,
        tenantId,
        organizationId,
        error,
      })
    }
  }
}
