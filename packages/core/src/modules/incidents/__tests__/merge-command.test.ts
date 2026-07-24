/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError, type CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  Incident,
  IncidentActionItem,
  IncidentImpact,
  IncidentTimelineEntry,
} from '../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (em: { flush?: () => Promise<void> }, callbacks: Array<() => unknown>) => {
    for (const callback of callbacks) await callback()
    await em.flush?.()
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  buildChanges: jest.fn(() => []),
  emitCrudSideEffects: jest.fn(async () => undefined),
  snapshotsEqual: jest.fn(() => false),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(async (
    em: { find: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.find(entity, where, options)),
  findOneWithDecryption: jest.fn(async (em: { findOne: (...args: unknown[]) => Promise<unknown> }, entity: unknown, where: unknown) =>
    em.findOne(entity, where),
  ),
  findAndCountWithDecryption: jest.fn(async (
    em: { findAndCount: (...args: unknown[]) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findAndCount(entity, where, options)),
}))

jest.mock('../events', () => ({
  emitIncidentsEvent: jest.fn(async () => undefined),
}))

jest.mock('../commands/impacts', () => ({
  recomputeIncidentRevenue: jest.fn(async () => undefined),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const TARGET_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const THIRD_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SEVERITY_ID = '11111111-1111-4111-8111-111111111111'
const ACTION_ITEM_ID = '22222222-2222-4222-8222-222222222222'
const IMPACT_ID = '33333333-3333-4333-8333-333333333333'
const TARGET_IMPACT_ID = '44444444-4444-4444-8444-444444444444'
const IMPACT_TARGET_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_TARGET_ID = '66666666-6666-4666-8666-666666666666'

function makeIncident(id: string, overrides: Partial<Incident> = {}): Incident {
  return {
    id,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    number: id === SOURCE_ID ? 'INC-001' : 'INC-002',
    title: id === SOURCE_ID ? 'Source incident' : 'Target incident',
    description: null,
    severityId: SEVERITY_ID,
    reporterUserId: USER_ID,
    status: 'open',
    escalationStatus: 'active',
    escalationLevel: 1,
    nextEscalationAt: new Date('2026-07-01T11:00:00.000Z'),
    snoozedUntil: new Date('2026-07-01T12:00:00.000Z'),
    mergedIntoIncidentId: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date('2026-07-01T09:00:00.000Z'),
    updatedAt: new Date('2026-07-01T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as Incident
}

function makeActionItem(overrides: Partial<IncidentActionItem> = {}): IncidentActionItem {
  return {
    id: ACTION_ITEM_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    incidentId: SOURCE_ID,
    title: 'Follow-up action',
    status: 'open',
    createdAt: new Date('2026-07-01T09:10:00.000Z'),
    updatedAt: new Date('2026-07-01T09:10:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as IncidentActionItem
}

function makeImpact(overrides: Partial<IncidentImpact> = {}): IncidentImpact {
  return {
    id: IMPACT_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    incidentId: SOURCE_ID,
    targetType: 'sales_order',
    targetId: IMPACT_TARGET_ID,
    componentLabel: null,
    impactStatus: 'major_outage',
    snapshot: { label: 'ORD-1' },
    revenueAmountMinor: '10000',
    revenueCurrency: 'USD',
    createdAt: new Date('2026-07-01T09:20:00.000Z'),
    updatedAt: new Date('2026-07-01T09:20:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as IncidentImpact
}

function buildHarness(input: {
  source?: Incident
  target?: Incident
  actionItems?: IncidentActionItem[]
  sourceImpacts?: IncidentImpact[]
  targetImpacts?: IncidentImpact[]
} = {}) {
  const source = input.source ?? makeIncident(SOURCE_ID)
  const target = input.target ?? makeIncident(TARGET_ID)
  const actionItems = input.actionItems ?? []
  const sourceImpacts = input.sourceImpacts ?? []
  const targetImpacts = input.targetImpacts ?? []
  const persisted: unknown[] = []

  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Incident) {
        if (where.id === source.id) return source
        if (where.id === target.id) return target
        if (where.id === THIRD_ID) return makeIncident(THIRD_ID)
      }
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === IncidentActionItem) {
        return actionItems.filter((item) => item.incidentId === where.incidentId && item.deletedAt == null)
      }
      if (entity === IncidentImpact) {
        const impacts = where.incidentId === source.id ? sourceImpacts : targetImpacts
        return impacts.filter((impact) => impact.deletedAt == null)
      }
      return []
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: `timeline-${persisted.length + 1}`,
      ...data,
    })),
    persist: jest.fn((entity: unknown) => {
      persisted.push(entity)
      return entity
    }),
    flush: jest.fn(async () => undefined),
    fork: jest.fn(function fork() {
      return this
    }),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return {}
      throw new Error(`unexpected resolve(${name})`)
    }),
  }
  const ctx = {
    container,
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      features: ['incidents.*'],
    },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: {
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
      allowedIds: [ORG_ID],
      tenantId: TENANT_ID,
    },
  }

  return { source, target, actionItems, sourceImpacts, targetImpacts, em, ctx, persisted }
}

function mergeHandler() {
  const handler = commandRegistry.get('incidents.incident.merge')
  expect(handler).toBeTruthy()
  return handler!
}

async function expectConflict(promise: Promise<unknown>, expectedMessage: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(isCrudHttpError(caught)).toBe(true)
  expect((caught as CrudHttpError).status).toBe(409)
  expect((caught as CrudHttpError).body).toMatchObject({
    error: expect.any(String),
    message: expectedMessage,
  })
}

describe('incidents.incident.merge command', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../commands/links')
  })

  it('rejects source==target', async () => {
    const { ctx } = buildHarness()

    await expectConflict(
      mergeHandler().execute({
        id: SOURCE_ID,
        targetIncidentId: SOURCE_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      }, ctx as never),
      '[internal] merge_self',
    )
  })

  it('rejects an already merged source incident', async () => {
    const { ctx } = buildHarness({
      source: makeIncident(SOURCE_ID, { mergedIntoIncidentId: TARGET_ID }),
    })

    let caught: unknown
    try {
      await mergeHandler().execute({
        id: SOURCE_ID,
        targetIncidentId: TARGET_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      }, ctx as never)
    } catch (error) {
      caught = error
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({ error: '[internal] incident_merged' })
  })

  it('closes the source, clears escalation, and re-points action items and impacts to the target', async () => {
    const actionItem = makeActionItem()
    const impact = makeImpact()
    const { source, target, em, ctx } = buildHarness({
      actionItems: [actionItem],
      sourceImpacts: [impact],
      targetImpacts: [],
    })

    const result = await mergeHandler().execute({
      id: SOURCE_ID,
      targetIncidentId: TARGET_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    }, ctx as never)

    expect(result).toMatchObject({
      incidentId: SOURCE_ID,
      targetIncidentId: TARGET_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
    expect(source.mergedIntoIncidentId).toBe(TARGET_ID)
    expect(source.status).toBe('closed')
    expect(source.escalationStatus).toBe('inactive')
    expect(source.nextEscalationAt).toBeNull()
    expect(source.snoozedUntil).toBeNull()
    expect(actionItem.incidentId).toBe(TARGET_ID)
    expect(impact.incidentId).toBe(TARGET_ID)
    expect(impact.deletedAt).toBeNull()
    expect(target.updatedAt).toBeInstanceOf(Date)
    expect(em.persist).toHaveBeenCalledWith(source)
    expect(em.persist).toHaveBeenCalledWith(target)
    expect(em.persist).toHaveBeenCalledWith(actionItem)
    expect(em.persist).toHaveBeenCalledWith(impact)
    expect(em.create).toHaveBeenCalledWith(IncidentTimelineEntry, expect.objectContaining({
      incidentId: SOURCE_ID,
      kind: 'merged_into',
    }))
    expect(em.create).toHaveBeenCalledWith(IncidentTimelineEntry, expect.objectContaining({
      incidentId: TARGET_ID,
      kind: 'merged_from',
    }))
  })

  it('soft-deletes duplicate source impacts instead of moving them to the target', async () => {
    const duplicateSourceImpact = makeImpact({
      id: IMPACT_ID,
      incidentId: SOURCE_ID,
      targetId: OTHER_TARGET_ID,
    })
    const existingTargetImpact = makeImpact({
      id: TARGET_IMPACT_ID,
      incidentId: TARGET_ID,
      targetId: OTHER_TARGET_ID,
    })
    const { em, ctx } = buildHarness({
      sourceImpacts: [duplicateSourceImpact],
      targetImpacts: [existingTargetImpact],
    })

    await mergeHandler().execute({
      id: SOURCE_ID,
      targetIncidentId: TARGET_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    }, ctx as never)

    expect(duplicateSourceImpact.incidentId).toBe(SOURCE_ID)
    expect(duplicateSourceImpact.deletedAt).toBeInstanceOf(Date)
    expect(duplicateSourceImpact.updatedAt).toBeInstanceOf(Date)
    expect(existingTargetImpact.incidentId).toBe(TARGET_ID)
    expect(existingTargetImpact.deletedAt).toBeNull()
    expect(em.persist).toHaveBeenCalledWith(duplicateSourceImpact)
  })
})
