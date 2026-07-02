import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { Incident, IncidentSettings, IncidentSeverity, IncidentType } from '../data/entities'
import type { IncidentCreateInput } from '../data/validators'
import type { IncidentCommandResult } from '../commands/incident'

const EVENT_ID = 'data_sync.run.failed'
const SOURCE_EVENT_REF_UNIQUE_INDEX = 'incidents_org_tenant_source_event_ref_unique'
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export const metadata = {
  event: EVENT_ID,
  persistent: true,
  id: 'incidents-auto-incident-data-sync',
}

type DataSyncRunFailedPayload = {
  runId?: string | null
  integrationId?: string | null
  entityType?: string | null
  direction?: string | null
  error?: string | null
  tenantId?: string | null
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

type IncidentScope = {
  organizationId: string
  tenantId: string
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

function text(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function buildTitle(payload: DataSyncRunFailedPayload): string {
  const subject = text(payload.entityType) ?? text(payload.integrationId) ?? text(payload.runId) ?? 'unknown run'
  const direction = text(payload.direction)
  return direction ? `Data sync run failed: ${subject} ${direction}` : `Data sync run failed: ${subject}`
}

function buildDescription(payload: DataSyncRunFailedPayload): string | null {
  const parts = [
    text(payload.error),
    payload.runId ? `Run: ${payload.runId}` : null,
    payload.integrationId ? `Integration: ${payload.integrationId}` : null,
    payload.entityType ? `Entity: ${payload.entityType}` : null,
    payload.direction ? `Direction: ${payload.direction}` : null,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length ? parts.join('\n') : null
}

export default async function handle(payload: DataSyncRunFailedPayload, ctx: ResolverContext): Promise<void> {
  try {
    const tenantId = text(payload.tenantId)
    const organizationId = text(payload.organizationId)
    const runId = text(payload.runId)
    if (!tenantId || !organizationId || !runId) return

    const scope = { tenantId, organizationId }
    const sourceEventRef = `${EVENT_ID}:${runId}`
    const em = ctx.resolve<EntityManager>('em').fork()
    const settings = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
    const trigger = settings?.autoIncidentTriggers?.[EVENT_ID]
    if (!trigger?.enabled) return

    const existing = await em.findOne(Incident, { sourceEventRef, ...scope, deletedAt: null })
    if (existing) return

    const [severity, incidentType] = await Promise.all([
      em.findOne(IncidentSeverity, { key: trigger.severity_key, ...scope, deletedAt: null, isActive: true }),
      em.findOne(IncidentType, { key: trigger.type_key, ...scope, deletedAt: null, isActive: true }),
    ])
    if (!severity || !incidentType) {
      console.warn('[incidents:auto-incident-data-sync] configured severity/type not found', {
        severityKey: trigger.severity_key,
        typeKey: trigger.type_key,
        tenantId,
        organizationId,
      })
      return
    }

    const commandBus = ctx.resolve<CommandBus>('commandBus')
    const commandContext = buildCommandContext(ctx, scope)
    const input: IncidentCreateInput = {
      organizationId,
      tenantId,
      title: buildTitle(payload),
      description: buildDescription(payload),
      incidentTypeId: incidentType.id,
      severityId: severity.id,
      priority: null,
      customerImpactSummary: null,
      sourceEventRef,
    }
    try {
      await commandBus.execute<IncidentCreateInput, IncidentCommandResult>(
        'incidents.incidents.create',
        { input, ctx: commandContext },
      )
    } catch (error) {
      if (isUniqueViolation(error, SOURCE_EVENT_REF_UNIQUE_INDEX)) {
        console.warn('[incidents:auto-incident-data-sync] incident already created by another delivery', { sourceEventRef })
        return
      }
      throw error
    }
  } catch (error) {
    console.error('[incidents:auto-incident-data-sync]', error)
  }
}
