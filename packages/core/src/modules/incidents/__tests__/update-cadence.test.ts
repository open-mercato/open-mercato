import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  Incident,
  IncidentImpact,
  IncidentPostmortem,
  IncidentSettings,
  IncidentSeverity,
  IncidentTimelineEntry,
  IncidentType,
} from '../data/entities'
import type { IncidentCreateInput, IncidentUpdateInput } from '../data/validators'
import type { IncidentChangeSeverityInput, IncidentTransitionInput } from '../data/action-validators'
import type { TimelineAddInput } from '../data/collab-validators'
import { emitIncidentsEvent } from '../events'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (em: { flush?: () => Promise<void> }, callbacks: Array<() => unknown | Promise<unknown>>) => {
    for (const callback of callbacks) await callback()
    await em.flush?.()
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn(() => []),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
  requireId: jest.fn((input: { id?: string }, message: string) => {
    if (!input.id) throw new Error(message)
    return input.id
  }),
  snapshotsEqual: jest.fn(() => false),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (...args: unknown[]) => Promise<unknown> }, entity: unknown, where: unknown) =>
    em.findOne(entity, where),
  ),
  findWithDecryption: jest.fn(async (em: { find: (...args: unknown[]) => Promise<unknown[]> }, entity: unknown, where: unknown, options?: unknown) =>
    em.find(entity, where, options),
  ),
}))

jest.mock('../events', () => ({
  emitIncidentsEvent: jest.fn(async () => undefined),
}))

jest.mock('../services/escalationService', () => ({
  resolveDefaultPolicyId: jest.fn(async () => null),
  startEscalation: jest.fn(async () => ({ started: false, recipients: [], level: 0, pendingEvents: [] })),
  applyPolicyChange: jest.fn(async () => ({ pendingEvents: [] })),
  clearEscalationForResolveClose: jest.fn((incident: Incident) => {
    incident.escalationStatus = 'inactive'
    incident.nextEscalationAt = null
  }),
  haltEscalationForAck: jest.fn(),
  manualEscalate: jest.fn(async () => ({
    pendingEvents: [],
    escalationLevel: 0,
    escalationStepCount: 0,
    escalationStatus: 'inactive',
    nextEscalationAt: null,
    pagedTargets: [],
    recipients: [],
  })),
  advanceEscalation: jest.fn(async () => ({
    advanced: false,
    exhausted: false,
    level: 0,
    escalationStatus: 'inactive',
    nextEscalationAt: null,
    recipients: [],
    pendingEvents: [],
  })),
  resolvePolicyForIncident: jest.fn(async () => null),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const INCIDENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SEVERITY_LOW_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SEVERITY_HIGH_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const TYPE_ID = '11111111-1111-4111-8111-111111111111'
const FIXED_NOW = new Date('2026-07-02T10:00:00.000Z')

type MockConnection = {
  execute: jest.Mock<Promise<unknown[]>, [string, unknown[]?]>
}

type MockEntityManager = {
  findOne: jest.Mock<Promise<unknown>, [unknown, Record<string, unknown>, unknown?]>
  find: jest.Mock<Promise<unknown[]>, [unknown, Record<string, unknown>, unknown?]>
  create: jest.Mock<unknown, [unknown, Record<string, unknown>]>
  persist: jest.Mock<unknown, [unknown]>
  flush: jest.Mock<Promise<void>, []>
  fork: jest.Mock<MockEntityManager, []>
  getConnection: jest.Mock<MockConnection, []>
}

type Harness = {
  incident: Incident | null
  getIncident: () => Incident | null
  settings: IncidentSettings | null
  severities: IncidentSeverity[]
  em: MockEntityManager
  ctx: CommandRuntimeContext
  persisted: unknown[]
  connection: MockConnection
}

function makeSeverity(id: string, key: string): IncidentSeverity {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    key,
    label: key,
    rank: key === 'sev1' ? 1 : 2,
    colorToken: 'status.warning',
    isDefault: key === 'sev2',
    isActive: true,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-01T09:00:00.000Z'),
    deletedAt: null,
  } as IncidentSeverity
}

function makeSettings(updateCadence: IncidentSettings['updateCadence']): IncidentSettings {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    numberFormat: 'INC-{seq:4}',
    ackTimeoutMinutes: null,
    escalationTimeoutMinutes: null,
    defaultEscalationPolicyId: null,
    slaTargets: null,
    updateCadence,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-01T09:00:00.000Z'),
    deletedAt: null,
  } as IncidentSettings
}

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: INCIDENT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: 'INC-1001',
    title: 'Checkout outage',
    description: null,
    incidentTypeId: null,
    severityId: SEVERITY_LOW_ID,
    priority: null,
    status: 'open',
    visibility: 'internal',
    isDrill: false,
    isMajor: false,
    ownerUserId: null,
    owningTeamId: null,
    reporterUserId: USER_ID,
    detectedAt: new Date('2026-07-02T09:00:00.000Z'),
    acknowledgedAt: null,
    startedAt: new Date('2026-07-02T09:00:00.000Z'),
    resolvedAt: null,
    closedAt: null,
    escalationLevel: 0,
    nextEscalationAt: null,
    nextUpdateDueAt: null,
    updateOverdueNotifiedAt: null,
    snoozedUntil: null,
    escalationPolicyId: null,
    escalationStatus: 'inactive',
    escalationRepeatsDone: 0,
    escalationLastTargets: null,
    slaResponseDueAt: null,
    slaResolutionDueAt: null,
    slaAtRisk: false,
    slaBreached: false,
    mergedIntoIncidentId: null,
    sourceEventRef: null,
    customerImpactSummary: null,
    createdAt: new Date('2026-07-02T09:00:00.000Z'),
    updatedAt: new Date('2026-07-02T09:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as Incident
}

function matchesScope(where: Record<string, unknown>): boolean {
  return where.organizationId === ORG_ID && where.tenantId === TENANT_ID
}

function buildHarness(input: {
  incident?: Incident | null
  settings?: IncidentSettings | null
  severities?: IncidentSeverity[]
  claimRows?: Array<{ id: string; number: string; tenant_id: string; organization_id: string }>
} = {}): Harness {
  const persisted: unknown[] = []
  const severities = input.severities ?? [
    makeSeverity(SEVERITY_LOW_ID, 'sev2'),
    makeSeverity(SEVERITY_HIGH_ID, 'sev1'),
  ]
  const state = {
    incident: input.incident === undefined ? makeIncident() : input.incident,
    settings: input.settings === undefined ? makeSettings({ sev2: { updateMinutes: 30 }, sev1: { updateMinutes: 60 } }) : input.settings,
    claimed: false,
  }
  const claimRows = input.claimRows ?? []
  const connection: MockConnection = {
    execute: jest.fn(async (query: string) => {
      if (!query.includes('update_overdue_notified_at')) return []
      if (state.claimed) return []
      state.claimed = true
      if (state.incident) state.incident.updateOverdueNotifiedAt = new Date(FIXED_NOW)
      return claimRows
    }),
  }
  const em: MockEntityManager = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Incident) {
        if (!matchesScope(where)) return null
        if (where.id && state.incident?.id !== where.id) return null
        return state.incident
      }
      if (entity === IncidentSettings) {
        return matchesScope(where) ? state.settings : null
      }
      if (entity === IncidentSeverity) {
        if (!matchesScope(where)) return null
        if (typeof where.id === 'string') {
          return severities.find((severity) => severity.id === where.id) ?? null
        }
        if (typeof where.key === 'string') {
          return severities.find((severity) => severity.key === where.key) ?? null
        }
        if (where.isDefault === true) {
          return severities.find((severity) => severity.isDefault) ?? null
        }
        return severities[0] ?? null
      }
      if (entity === IncidentType) {
        if (!matchesScope(where)) return null
        if (where.id === TYPE_ID) return { id: TYPE_ID, defaultEscalationPolicyId: null, requiredFieldsOnResolve: null }
        return null
      }
      if (entity === IncidentPostmortem) return null
      return null
    }),
    find: jest.fn(async (entity: unknown) => {
      if (entity === IncidentImpact) return []
      if (entity === Incident) return []
      if (entity === IncidentSeverity) return severities
      return []
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === Incident) {
        const incident = makeIncident({
          ...data,
          id: typeof data.id === 'string' ? data.id : INCIDENT_ID,
        } as Partial<Incident>)
        state.incident = incident
        return incident
      }
      if (entity === IncidentTimelineEntry) {
        return {
          id: `timeline-${persisted.length + 1}`,
          ...data,
        } as IncidentTimelineEntry
      }
      if (entity === IncidentPostmortem) {
        return {
          id: '33333333-3333-4333-8333-333333333333',
          ...data,
        } as IncidentPostmortem
      }
      return { ...data }
    }),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
      return entity
    }),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(function fork(this: MockEntityManager) {
      return this
    }),
    getConnection: jest.fn(() => connection),
  }
  const container = {
    resolve: jest.fn((name: string): unknown => {
      if (name === 'em') return em
      if (name === 'dataEngine') return {}
      if (name === 'incidentNumberGenerator') {
        return {
          allocate: jest.fn(async () => 'INC-1001'),
        }
      }
      throw new Error(`[internal] unexpected resolve(${name})`)
    }),
  }
  const ctx: CommandRuntimeContext = {
    container: container as unknown as AwilixContainer,
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: ['incidents.*'],
    },
    organizationScope: {
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
      allowedIds: [ORG_ID],
      tenantId: TENANT_ID,
    },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return {
    incident: state.incident,
    getIncident: () => state.incident,
    settings: state.settings,
    severities,
    em,
    ctx,
    persisted,
    connection,
  }
}

function command<TInput, TResult>(id: string): CommandHandler<TInput, TResult> {
  const handler = commandRegistry.get<TInput, TResult>(id)
  if (!handler) throw new Error(`[internal] command missing: ${id}`)
  return handler
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

describe('incidents customer update cadence runtime', () => {
  let runSweep: typeof import('../workers/escalation-sweep').default

  beforeAll(async () => {
    commandRegistry.clear()
    await import('../commands/incident')
    await import('../commands/actions')
    await import('../commands/timeline')
    runSweep = (await import('../workers/escalation-sweep')).default
  })

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW })
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('computes next update due on create from severity cadence settings', async () => {
    const harness = buildHarness()

    await command<IncidentCreateInput, unknown>('incidents.incidents.create').execute({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      title: 'Checkout outage',
      description: null,
      incidentTypeId: null,
      severityId: SEVERITY_LOW_ID,
      priority: null,
      customerImpactSummary: null,
    }, harness.ctx)

    expect(iso(harness.getIncident()?.nextUpdateDueAt)).toBe('2026-07-02T10:30:00.000Z')
    expect(harness.getIncident()?.updateOverdueNotifiedAt).toBeNull()
  })

  it('recomputes cadence when severity changes', async () => {
    const incident = makeIncident({
      nextUpdateDueAt: new Date('2026-07-02T10:20:00.000Z'),
      updateOverdueNotifiedAt: new Date('2026-07-02T10:21:00.000Z'),
    })
    const harness = buildHarness({ incident })

    await command<IncidentChangeSeverityInput, unknown>('incidents.incident.change_severity').execute({
      id: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      severityId: SEVERITY_HIGH_ID,
    }, harness.ctx)

    expect(incident.severityId).toBe(SEVERITY_HIGH_ID)
    expect(iso(incident.nextUpdateDueAt)).toBe('2026-07-02T11:00:00.000Z')
    expect(incident.updateOverdueNotifiedAt).toBeNull()
  })

  it('resets cadence and clears the notified claim for customer-facing timeline entries', async () => {
    const incident = makeIncident({
      nextUpdateDueAt: new Date('2026-07-02T09:30:00.000Z'),
      updateOverdueNotifiedAt: new Date('2026-07-02T09:31:00.000Z'),
    })
    const harness = buildHarness({ incident })

    await command<TimelineAddInput, unknown>('incidents.timeline_entries.add').execute({
      id: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      kind: 'update',
      body: 'Customer update',
      visibility: 'customer_facing',
    }, harness.ctx)

    expect(iso(incident.nextUpdateDueAt)).toBe('2026-07-02T10:30:00.000Z')
    expect(incident.updateOverdueNotifiedAt).toBeNull()
  })

  it('does not reset cadence for internal timeline entries', async () => {
    const nextUpdateDueAt = new Date('2026-07-02T09:30:00.000Z')
    const updateOverdueNotifiedAt = new Date('2026-07-02T09:31:00.000Z')
    const incident = makeIncident({ nextUpdateDueAt, updateOverdueNotifiedAt })
    const harness = buildHarness({ incident })

    await command<TimelineAddInput, unknown>('incidents.timeline_entries.add').execute({
      id: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      kind: 'note',
      body: 'Internal note',
      visibility: 'internal',
    }, harness.ctx)

    expect(incident.nextUpdateDueAt).toBe(nextUpdateDueAt)
    expect(incident.updateOverdueNotifiedAt).toBe(updateOverdueNotifiedAt)
  })

  it('clears cadence fields when resolving', async () => {
    const incident = makeIncident({
      nextUpdateDueAt: new Date('2026-07-02T09:30:00.000Z'),
      updateOverdueNotifiedAt: new Date('2026-07-02T09:31:00.000Z'),
    })
    const harness = buildHarness({ incident })

    await command<IncidentTransitionInput, unknown>('incidents.incident.transition_status').execute({
      id: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      status: 'resolved',
    }, harness.ctx)

    expect(incident.status).toBe('resolved')
    expect(incident.nextUpdateDueAt).toBeNull()
    expect(incident.updateOverdueNotifiedAt).toBeNull()
  })

  it('claims overdue updates atomically and emits once per due window', async () => {
    const incident = makeIncident({
      nextUpdateDueAt: new Date('2026-07-02T09:30:00.000Z'),
      updateOverdueNotifiedAt: null,
    })
    const harness = buildHarness({
      incident,
      claimRows: [{
        id: INCIDENT_ID,
        number: 'INC-1001',
        tenant_id: TENANT_ID,
        organization_id: ORG_ID,
      }],
    })

    await runSweep({ payload: { scope: { tenantId: TENANT_ID, organizationId: ORG_ID } } } as never, {
      resolve: (name: string): unknown => {
        if (name === 'em') return harness.em as unknown as EntityManager
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    } as never)
    await runSweep({ payload: { scope: { tenantId: TENANT_ID, organizationId: ORG_ID } } } as never, {
      resolve: (name: string): unknown => {
        if (name === 'em') return harness.em as unknown as EntityManager
        throw new Error(`[internal] unexpected resolve(${name})`)
      },
    } as never)

    expect(harness.connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('"update_overdue_notified_at" = now()'),
      [ORG_ID, TENANT_ID],
    )
    expect(emitIncidentsEvent).toHaveBeenCalledTimes(1)
    expect(emitIncidentsEvent).toHaveBeenCalledWith(
      'incidents.incident.update_overdue',
      expect.objectContaining({
        id: INCIDENT_ID,
        incidentId: INCIDENT_ID,
        number: 'INC-1001',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }),
      { persistent: true },
    )
    expect(findWithDecryption).toHaveBeenCalledWith(
      harness.em,
      Incident,
      expect.objectContaining({ organizationId: ORG_ID, tenantId: TENANT_ID }),
      undefined,
      { organizationId: ORG_ID, tenantId: TENANT_ID },
    )
  })

  it('excludes soft-deleted portal users when resolving customer update recipients', async () => {
    const harness = buildHarness()
    const { emitIncidentCustomerUpdated } = await import('../commands/actions')

    await emitIncidentCustomerUpdated(harness.ctx, makeIncident(), ['55555555-5555-4555-8555-555555555555'])

    expect(harness.connection.execute).toHaveBeenCalledWith(
      expect.stringContaining('"deleted_at" is null'),
      [TENANT_ID, ORG_ID, '55555555-5555-4555-8555-555555555555', '55555555-5555-4555-8555-555555555555'],
    )
  })

  it('leaves cadence fields null when no cadence is configured', async () => {
    const harness = buildHarness({ settings: makeSettings(null) })

    await command<IncidentCreateInput, unknown>('incidents.incidents.create').execute({
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      title: 'Checkout outage',
      description: null,
      incidentTypeId: null,
      severityId: SEVERITY_LOW_ID,
      priority: null,
      customerImpactSummary: null,
    }, harness.ctx)

    expect(harness.getIncident()?.nextUpdateDueAt).toBeNull()
    expect(harness.getIncident()?.updateOverdueNotifiedAt).toBeNull()
  })

  it('recomputes cadence through the general update command when severity changes there', async () => {
    const incident = makeIncident({
      nextUpdateDueAt: new Date('2026-07-02T10:20:00.000Z'),
      updateOverdueNotifiedAt: new Date('2026-07-02T10:21:00.000Z'),
    })
    const harness = buildHarness({ incident })

    await command<IncidentUpdateInput, unknown>('incidents.incidents.update').execute({
      id: INCIDENT_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      severityId: SEVERITY_HIGH_ID,
    }, harness.ctx)

    expect(incident.severityId).toBe(SEVERITY_HIGH_ID)
    expect(iso(incident.nextUpdateDueAt)).toBe('2026-07-02T11:00:00.000Z')
    expect(incident.updateOverdueNotifiedAt).toBeNull()
  })
})
