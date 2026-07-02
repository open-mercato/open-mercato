import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { Incident, IncidentSettings, IncidentSeverity, IncidentType } from '../data/entities'
import type { IncidentCreateInput } from '../data/validators'
import type { IncidentCommandResult } from '../commands/incident'

const EVENT_ID = 'integrations.state.updated'
const UNHEALTHY_STATE = 'reauth_required'
const SOURCE_EVENT_REF_UNIQUE_INDEX = 'incidents_org_tenant_source_event_ref_unique'
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

export const metadata = {
  event: EVENT_ID,
  persistent: true,
  id: 'incidents-auto-incident-integrations',
}

type IntegrationsStateUpdatedPayload = {
  integrationId?: string | null
  isEnabled?: boolean | null
  reauthRequired?: boolean | null
  tenantId?: string | null
  organizationId?: string | null
  userId?: string | null
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

export default async function handle(payload: IntegrationsStateUpdatedPayload, ctx: ResolverContext): Promise<void> {
  try {
    if (payload.reauthRequired !== true) return

    const tenantId = text(payload.tenantId)
    const organizationId = text(payload.organizationId)
    const integrationId = text(payload.integrationId)
    if (!tenantId || !organizationId || !integrationId) return

    const scope = { tenantId, organizationId }
    const sourceEventRef = `${EVENT_ID}:${integrationId}:${UNHEALTHY_STATE}`
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
      console.warn('[incidents:auto-incident-integrations] configured severity/type not found', {
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
      title: `Integration needs reauthorization: ${integrationId}`,
      description: `Integration ${integrationId} requires reauthorization before it can continue normal operation.`,
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
        console.warn('[incidents:auto-incident-integrations] incident already created by another delivery', { sourceEventRef })
        return
      }
      throw error
    }
  } catch (error) {
    console.error('[incidents:auto-incident-integrations]', error)
  }
}
