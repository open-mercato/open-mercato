import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import {
  IncidentEscalationPolicy,
  IncidentRole,
  IncidentSettings,
  IncidentSeverity,
  IncidentType,
  type IncidentAutoIncidentTriggers,
  type IncidentSlaTargets,
} from './data/entities'

const DEFAULT_NUMBER_FORMAT = 'INC-{yyyy}{mm}{dd}-{seq:4}'
const INCIDENTS_ESCALATION_SWEEP_QUEUE = 'incidents-escalation-sweep'

type SchedulerServiceLike = {
  register: (cfg: Record<string, unknown>) => Promise<unknown>
}

type SeveritySeed = {
  key: string
  label: string
  rank: number
  colorToken: string
  isDefault: boolean
}

type TypeSeed = {
  key: string
  label: string
  defaultSeverityId: string | null
  defaultRoleIds: string[] | null
  requiredFieldsOnResolve: string[] | null
  isDefault: boolean
}

type RoleSeed = {
  key: string
  label: string
}

const DEFAULT_SEVERITIES: SeveritySeed[] = [
  { key: 'sev1', label: 'Critical', rank: 1, colorToken: 'error', isDefault: false },
  { key: 'sev2', label: 'High', rank: 2, colorToken: 'warning', isDefault: false },
  { key: 'sev3', label: 'Medium', rank: 3, colorToken: 'info', isDefault: true },
  { key: 'sev4', label: 'Low', rank: 4, colorToken: 'neutral', isDefault: false },
]

const DEFAULT_TYPES: TypeSeed[] = [
  { key: 'operational', label: 'Operational', defaultSeverityId: null, defaultRoleIds: null, requiredFieldsOnResolve: null, isDefault: true },
  { key: 'customer_impacting', label: 'Customer impacting', defaultSeverityId: null, defaultRoleIds: null, requiredFieldsOnResolve: ['root_cause'], isDefault: false },
  { key: 'security', label: 'Security', defaultSeverityId: null, defaultRoleIds: null, requiredFieldsOnResolve: ['root_cause'], isDefault: false },
  { key: 'maintenance', label: 'Maintenance', defaultSeverityId: null, defaultRoleIds: null, requiredFieldsOnResolve: null, isDefault: false },
]

const DEFAULT_ROLES: RoleSeed[] = [
  { key: 'commander', label: 'Commander' },
  { key: 'comms_lead', label: 'Comms Lead' },
  { key: 'scribe', label: 'Scribe' },
  { key: 'responder', label: 'Responder' },
]

function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function stableEscalationSweepScheduleId(organizationId: string, tenantId: string): string {
  return stableScheduleUuid(`${organizationId}:${tenantId}:${INCIDENTS_ESCALATION_SWEEP_QUEUE}`)
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const missingSeverities: SeveritySeed[] = []
    const missingTypes: TypeSeed[] = []
    const missingRoles: RoleSeed[] = []

    for (const severity of DEFAULT_SEVERITIES) {
      const existing = await ctx.em.findOne(IncidentSeverity, {
        ...scope,
        key: severity.key,
        deletedAt: null,
      })
      if (!existing) missingSeverities.push(severity)
    }

    for (const type of DEFAULT_TYPES) {
      const existing = await ctx.em.findOne(IncidentType, {
        ...scope,
        key: type.key,
        deletedAt: null,
      })
      if (!existing) missingTypes.push(type)
    }

    for (const role of DEFAULT_ROLES) {
      const existing = await ctx.em.findOne(IncidentRole, {
        ...scope,
        key: role.key,
        deletedAt: null,
      })
      if (!existing) missingRoles.push(role)
    }

    for (const severity of missingSeverities) {
      ctx.em.persist(ctx.em.create(IncidentSeverity, { ...scope, ...severity }))
    }

    for (const type of missingTypes) {
      ctx.em.persist(ctx.em.create(IncidentType, { ...scope, ...type }))
    }

    for (const role of missingRoles) {
      ctx.em.persist(ctx.em.create(IncidentRole, { ...scope, ...role }))
    }

    await ctx.em.flush()

    const commander = await ctx.em.findOne(IncidentRole, {
      ...scope,
      key: 'commander',
      deletedAt: null,
    })
    let defaultPolicy = await ctx.em.findOne(IncidentEscalationPolicy, {
      ...scope,
      key: 'default',
      deletedAt: null,
    })

    if (!defaultPolicy) {
      defaultPolicy = ctx.em.create(IncidentEscalationPolicy, {
        ...scope,
        key: 'default',
        name: 'Default escalation',
        isDefault: true,
        isActive: true,
        repeatCount: 1,
        steps: [
          { delayMinutes: 15, targets: commander ? [{ type: 'role', id: commander.id }] : [], notifyStrategy: 'all' },
          { delayMinutes: 30, targets: commander ? [{ type: 'role', id: commander.id }] : [], notifyStrategy: 'all' },
        ],
      })
      ctx.em.persist(defaultPolicy)
      await ctx.em.flush()
    }

    const existingSettings = await ctx.em.findOne(IncidentSettings, {
      ...scope,
      deletedAt: null,
    })

    if (!existingSettings) {
      const slaTargets: IncidentSlaTargets = {}
      const autoIncidentTriggers: IncidentAutoIncidentTriggers = {}
      ctx.em.persist(ctx.em.create(IncidentSettings, {
        ...scope,
        numberFormat: DEFAULT_NUMBER_FORMAT,
        ackTimeoutMinutes: 30,
        escalationTimeoutMinutes: 30,
        defaultEscalationPolicyId: defaultPolicy.id,
        slaTargets,
        autoIncidentTriggers,
      }))
    } else if (!existingSettings.defaultEscalationPolicyId) {
      existingSettings.defaultEscalationPolicyId = defaultPolicy.id
      existingSettings.updatedAt = new Date()
    }

    const defaultType =
      await ctx.em.findOne(IncidentType, { ...scope, isDefault: true, deletedAt: null }) ??
      await ctx.em.findOne(IncidentType, { ...scope, key: 'operational', deletedAt: null })
    if (defaultType && !defaultType.defaultEscalationPolicyId) {
      defaultType.defaultEscalationPolicyId = defaultPolicy.id
      defaultType.updatedAt = new Date()
    }

    await ctx.em.flush()

    const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle?.hasRegistration === 'function' && cradle.hasRegistration('schedulerService')) {
      const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
      try {
        await schedulerService.register({
          id: stableEscalationSweepScheduleId(ctx.organizationId, ctx.tenantId),
          name: 'Incidents escalation sweep',
          description:
            'Advances due incident escalations, expires snoozes, and sets SLA at-risk/breach flags every 60s.',
          scopeType: 'organization',
          organizationId: ctx.organizationId,
          tenantId: ctx.tenantId,
          scheduleType: 'interval',
          scheduleValue: '60s',
          timezone: 'UTC',
          targetType: 'queue',
          targetQueue: INCIDENTS_ESCALATION_SWEEP_QUEUE,
          targetPayload: { scope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId } },
          sourceType: 'module',
          sourceModule: 'incidents',
          isEnabled: true,
        })
      } catch (error) {
        console.warn('[incidents.setup] failed to register escalation-sweep schedule', error)
      }
    }
  },

  defaultRoleFeatures: {
    admin: ['incidents.*'],
    employee: [
      'incidents.incident.view',
      'incidents.incident.create',
      'incidents.incident.manage',
      'incidents.incident.assign',
      'incidents.incident.escalate',
      'incidents.postmortem.view',
      'incidents.postmortem.manage',
    ],
  },
}

export default setup
