import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CustomersToolContext } from '../../ai-tools/types'
import type { z } from 'zod'

type Row = Record<string, unknown>
type QueryOptions = { limit?: number; offset?: number; orderBy?: Record<string, string> }
type ApiOperation = { method: 'POST' | 'PUT' | 'DELETE'; path: string; body?: Row }
type RunnerContext = CustomersToolContext & { tool?: { requiredFeatures?: string[] } }
type CrudAction = {
  commandId: string
  schema: z.ZodType
  mapInput: (input: { raw: Row; parsed: Row; ctx: CommandRuntimeContext }) => Promise<unknown>
  response: (input: { result: unknown }) => unknown
  status?: number
}
type CrudConfiguration = { actions: { create: CrudAction; update: CrudAction; delete: CrudAction } }

const mockRunnerContexts: RunnerContext[] = []
const mockOperations: ApiOperation[] = []
const mockActivityReads: QueryOptions[] = []
let mockDispatch: (operation: ApiOperation) => Promise<Response>
let mockExecute: (id: string, input: unknown, request?: Request) => Promise<{ result: unknown }>
let mockRead: (entity: unknown, where: Row, options?: QueryOptions) => unknown[]
let mockRequestContext: Record<string, unknown>
let mockCommandContext: CommandRuntimeContext
let mockFlags = { unified: false, legacyAdapters: true, externalSync: false }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async (_em: unknown, entity: unknown, where: Row, options?: QueryOptions) => {
    mockActivityReads.push(options ?? {})
    return mockRead(entity, where, options)
  },
  findOneWithDecryption: async (_em: unknown, entity: unknown, where: Row) => mockRead(entity, where)[0] ?? null,
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner', () => ({
  createAiApiOperationRunner: (ctx: RunnerContext) => {
    mockRunnerContexts.push(ctx)
    return {
      run: async (operation: ApiOperation) => {
        mockOperations.push(operation)
        const response = await mockDispatch(operation)
        const data: unknown = await response.json()
        return { success: response.ok, statusCode: response.status, data }
      },
    }
  },
}))

jest.mock('../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: async () => mockFlags,
}))

jest.mock('../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: async (request: Request) => ({
    ...mockRequestContext,
    commandContext: { ...mockCommandContext, request },
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => null),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (configuration: CrudConfiguration) => {
    const createHandler = (action: CrudAction) => async (request: Request) => {
      const raw = await request.json() as Row
      const parsed = action.schema.parse(raw) as Row
      const input = await action.mapInput({ raw, parsed, ctx: { ...mockCommandContext, request } })
      const { result } = await mockExecute(action.commandId, input, request)
      return Response.json(action.response({ result }), { status: action.status ?? 200 })
    }
    return {
      POST: createHandler(configuration.actions.create),
      PUT: createHandler(configuration.actions.update),
      DELETE: createHandler(configuration.actions.delete),
    }
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/helpers'),
  setCustomFieldsIfAny: jest.fn(async () => undefined),
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldValues: jest.fn(async () => ({})),
  loadCustomFieldDefinitionIndex: jest.fn(async () => new Map()),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceRecordGoneIsConflict: jest.fn(),
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

jest.mock('../../lib/calendar/eventTypeResolver', () => ({
  resolveScopedCalendarEventTypes: jest.fn(async () => ({ items: [] })),
  resolveCatalogEventType: (_catalog: unknown, key: string) => ({
    key,
    selectable: true,
    behavior: {
      schemaVersion: 1,
      baseKind: 'meeting',
      selectable: true,
      order: 0,
      fields: { endTime: true, allDay: true, recurrence: true, location: 'location', people: 'attendees', priority: true, resources: true },
      customFieldsetIds: [],
    },
  }),
}))

jest.mock('../../lib/interactionProjection', () => ({
  recomputeNextInteraction: jest.fn(async () => ({ nextInteractionId: null })),
}))

jest.mock('../../lib/conversationShares', () => ({
  listGrantsForViewer: jest.fn(async () => []),
  listSharedChannelIds: jest.fn(async () => []),
}))

jest.mock('../../commands/shared', () => ({
  ...jest.requireActual('../../commands/shared'),
  requireTimelineParentEntity: async (_em: unknown, id: string) => mockRead(CustomerEntity, { id })[0],
  requireDealInScope: jest.fn(async () => undefined),
  emitQueryIndexUpsertEvents: jest.fn(async () => undefined),
  resolveParentResourceKind: jest.fn(() => 'customers.person'),
}))

import activitiesTasksAiTools from '../../ai-tools/activities-tasks-pack'
import { CustomerActivity, CustomerDeal, CustomerDealPersonLink, CustomerEntity, CustomerInteraction } from '../../data/entities'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { POST, PUT, DELETE } from '../../api/activities/route'
import { POST as canonicalPost, PUT as canonicalPut, DELETE as canonicalDelete } from '../../api/interactions/route'
import '../../commands/interactions'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const PERSON_ID = '33333333-3333-4333-8333-333333333333'
const DEAL_ID = '44444444-4444-4444-8444-444444444444'
const LEGACY_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_ORGANIZATION_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_TENANT_ID = '77777777-7777-4777-8777-777777777777'
const INITIAL_DATE = new Date('2026-10-01T12:00:00.000Z')
const OCCURRED_AT = '2026-10-01T11:00:00.000Z'

function findTool(name: string) {
  const tool = activitiesTasksAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool
}

function asRecord(value: unknown): Row {
  if (!value || typeof value !== 'object') throw new Error('Expected an object')
  return value as Row
}

function relationValue(value: unknown): unknown {
  return value && typeof value === 'object' && 'id' in value ? value.id : value
}

function matchesValue(value: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    const operator = expected as Row
    if ('$ne' in operator) return relationValue(value) !== operator.$ne
    if ('$in' in operator) return Array.isArray(operator.$in) && operator.$in.includes(relationValue(value))
    if ('$nin' in operator) {
      const excluded = operator.$nin
      const ids = Array.isArray(excluded) ? excluded : asRecord(excluded).ids
      return Array.isArray(ids) && !ids.includes(relationValue(value))
    }
  }
  return expected === null ? value == null : relationValue(value) === expected
}

function matches(row: Row, criteria: Row): boolean {
  return Object.entries(criteria).every(([key, expected]) => {
    if (key === '$and') return Array.isArray(expected) && expected.every((part: unknown) => matches(row, asRecord(part)))
    if (key === '$or') return Array.isArray(expected) && expected.some((part: unknown) => matches(row, asRecord(part)))
    return matchesValue(row[key], expected)
  })
}

function makeHarness() {
  const interactions = new Map<string, CustomerInteraction>()
  const legacy = new Map<string, CustomerActivity>()
  const person = Object.assign(new CustomerEntity(), { id: PERSON_ID, kind: 'person', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
  const deal = Object.assign(new CustomerDeal(), { id: DEAL_ID, title: 'Lifecycle deal', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, updatedAt: INITIAL_DATE })
  const fingerprints = new Map<string, string>()
  let sequence = 0
  let flushSequence = 0

  mockRead = (entity, where, options = {}) => {
    const records: unknown[] = entity === CustomerInteraction ? [...interactions.values()]
      : entity === CustomerActivity ? [...legacy.values()]
        : entity === CustomerEntity ? [person]
          : entity === CustomerDeal ? [deal]
            : entity === CustomerDealPersonLink ? [{ id: 'person-link', deal: DEAL_ID, person }]
              : []
    const result = records.filter((row) => matches(asRecord(row), where))
    if (options.orderBy) {
      const fields = Object.entries(options.orderBy)
      result.sort((left, right) => {
        for (const [field, direction] of fields) {
          const leftValue = asRecord(left)[field]
          const rightValue = asRecord(right)[field]
          if (leftValue == null && rightValue == null) continue
          if (leftValue == null) return 1
          if (rightValue == null) return -1
          const comparison = leftValue instanceof Date && rightValue instanceof Date
            ? leftValue.getTime() - rightValue.getTime() : String(leftValue).localeCompare(String(rightValue))
          if (comparison) return direction.startsWith('DESC') ? -comparison : comparison
        }
        return 0
      })
    }
    return result.slice(options.offset ?? 0, options.limit === undefined ? undefined : (options.offset ?? 0) + options.limit)
  }

  const em = {
    fork: () => em,
    isInTransaction: () => false,
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    findOne: jest.fn(async (entity: unknown, where: Row) => mockRead(entity, where)[0] ?? null),
    count: jest.fn(async (entity: unknown, where: Row) => mockRead(entity, where).length),
    createQueryBuilder: jest.fn(() => ({
      select: () => ({ where: (scope: Row) => ({ ids: [...interactions.values()].filter((row) => matches(asRecord(row), scope)).map((row) => row.id) }) }),
    })),
    create: jest.fn((_entity: unknown, values: Row) => {
      sequence += 1
      return Object.assign(new CustomerInteraction(), {
        id: `88888888-8888-4888-8888-${String(sequence).padStart(12, '0')}`,
        createdAt: INITIAL_DATE,
        updatedAt: INITIAL_DATE,
        deletedAt: null,
      }, values)
    }),
    persist: jest.fn((row: CustomerInteraction) => interactions.set(row.id, row)),
    flush: jest.fn(async () => {
      for (const row of interactions.values()) {
        const current = JSON.stringify({ ...row, updatedAt: undefined })
        if (fingerprints.get(row.id) !== current) {
          flushSequence += 1
          row.updatedAt = new Date(INITIAL_DATE.getTime() + flushSequence * 1000)
          fingerprints.set(row.id, current)
        }
      }
    }),
  }

  const commandBus = {
    execute: jest.fn(async (id: string, operation: { input: unknown; ctx: CommandRuntimeContext }) => {
      const command = commandRegistry.get(id)
      if (!command) throw new Error(`Missing command ${id}`)
      const result = await command.execute(operation.input, operation.ctx)
      return { result }
    }),
  }
  const container = {
    resolve: (name: string): unknown => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      if (name === 'dataEngine') return { setCustomFields: async () => undefined }
      if (name === 'organizationHierarchyService') return { resolveAncestorIds: async () => [] }
      if (name === 'eventBus') return { emitEvent: async () => undefined }
      throw new Error(`Unexpected dependency ${name}`)
    },
  }
  const ctx = {
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    userId: 'actor',
    userFeatures: ['customers.activities.view', 'customers.activities.manage', 'customers.interactions.manage'],
    isSuperAdmin: false,
    container,
    tool: { requiredFeatures: ['customers.activities.manage'] },
  } as unknown as RunnerContext
  mockCommandContext = {
    container,
    auth: { sub: 'actor', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    organizationScope: null,
    organizationIds: [ORGANIZATION_ID],
    selectedOrganizationId: ORGANIZATION_ID,
  } as unknown as CommandRuntimeContext
  mockRequestContext = { ...mockCommandContext, em }
  mockExecute = (id, input, request) => commandBus.execute(id, { input, ctx: { ...mockCommandContext, request } })
  mockDispatch = async (operation) => {
    const request = new Request(`http://localhost/api${operation.path}`, {
      method: operation.method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(operation.body ?? {}),
    })
    const handlers = operation.path === '/customers/activities'
      ? { POST, PUT, DELETE } : { POST: canonicalPost, PUT: canonicalPut, DELETE: canonicalDelete }
    return handlers[operation.method](request)
  }
  return { ctx, em, interactions, legacy, person, deal, commandBus }
}

function seedLegacy(harness: ReturnType<typeof makeHarness>, values: Partial<CustomerActivity> = {}) {
  const activity = Object.assign(new CustomerActivity(), {
    id: LEGACY_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    entity: harness.person,
    deal: harness.deal,
    activityType: 'call',
    subject: 'Historical call',
    body: 'Original notes',
    occurredAt: new Date(OCCURRED_AT),
    createdAt: INITIAL_DATE,
    updatedAt: INITIAL_DATE,
    ...values,
  })
  harness.legacy.set(activity.id, activity)
  return activity
}

beforeEach(() => {
  mockFlags = { unified: false, legacyAdapters: true, externalSync: false }
  mockOperations.length = 0
  mockRunnerContexts.length = 0
  mockActivityReads.length = 0
})

describe.each([false, true])('activity tools with unified=%s', (unified) => {
  it.each(['customers.manage_record_activity', 'customers.manage_deal_activity'])('%s reads and mutates its canonical creation through the actual activity route and commands', async (toolName) => {
    mockFlags.unified = unified
    const harness = makeHarness()
    const tool = findTool(toolName)
    const created = asRecord(await tool.handler({
      operation: 'create',
      ...(toolName === 'customers.manage_record_activity' ? { personId: PERSON_ID } : { dealId: DEAL_ID }),
      activityType: 'call',
      subject: 'First call',
      body: 'First notes',
      occurredAt: OCCURRED_AT,
    }, harness.ctx))
    const activityId = String(created.activityId)
    expect(harness.interactions.size).toBe(1)
    expect(harness.legacy.size).toBe(0)
    expect(harness.commandBus.execute).toHaveBeenCalledWith('customers.interactions.create', expect.objectContaining({ input: expect.objectContaining({ interactionType: 'call', title: 'First call' }) }))

    const listed = asRecord(await findTool('customers.list_activities').handler({ personId: PERSON_ID }, harness.ctx))
    expect(listed.items).toEqual([expect.objectContaining({ id: activityId, activityType: 'call', subject: 'First call', body: 'First notes', entityId: PERSON_ID })])
    expect(listed.total).toBe(1)
    const snapshot = await tool.loadBeforeRecord?.({ operation: 'update', activityId, subject: 'Second call' }, harness.ctx)
    expect(snapshot).toMatchObject({ recordId: activityId, entityType: 'customers.customer_interaction', recordVersion: harness.interactions.get(activityId)?.updatedAt.toISOString(), before: { subject: 'First call' } })

    const updated = asRecord(await tool.handler({ operation: 'update', activityId, subject: 'Second call', body: 'Second notes' }, harness.ctx))
    expect(updated.before).toMatchObject({ subject: 'First call', body: 'First notes' })
    expect(updated.after).toMatchObject({ subject: 'Second call', body: 'Second notes' })
    const deleteSnapshot = await tool.loadBeforeRecord?.({ operation: 'delete', activityId }, harness.ctx)
    expect(deleteSnapshot).toMatchObject({ entityType: 'customers.customer_interaction', recordVersion: harness.interactions.get(activityId)?.updatedAt.toISOString(), before: { subject: 'Second call' } })
    expect(deleteSnapshot?.recordVersion).not.toBe(snapshot?.recordVersion)

    await tool.handler({ operation: 'delete', activityId }, harness.ctx)
    expect(harness.interactions.get(activityId)?.deletedAt).toBeInstanceOf(Date)
    expect(await tool.loadBeforeRecord?.({ operation: 'delete', activityId }, harness.ctx)).toBeNull()
    expect(asRecord(await findTool('customers.list_activities').handler({ personId: PERSON_ID }, harness.ctx))).toMatchObject({ items: [], total: 0 })
    expect(mockOperations.map((operation) => operation.path)).toEqual(['/customers/activities', '/customers/activities', '/customers/activities'])
  })
})

describe('canonical activity dispatch when compatibility adapters are disabled', () => {
  it.each(['customers.manage_record_activity', 'customers.manage_deal_activity'])('%s uses the canonical route configuration and real commands', async (toolName) => {
    mockFlags.legacyAdapters = false
    const harness = makeHarness()
    const tool = findTool(toolName)
    const created = asRecord(await tool.handler({
      operation: 'create',
      ...(toolName === 'customers.manage_record_activity' ? { personId: PERSON_ID } : { dealId: DEAL_ID }),
      activityType: 'call',
      subject: 'Canonical call',
      occurredAt: OCCURRED_AT,
    }, harness.ctx))
    const activityId = String(created.activityId)
    expect(harness.interactions.get(activityId)).toMatchObject({ interactionType: 'call', title: 'Canonical call', status: 'done' })
    expect(asRecord(await findTool('customers.list_activities').handler({}, harness.ctx))).toMatchObject({ items: [expect.objectContaining({ id: activityId })], total: 1 })
    await tool.handler({ operation: 'update', activityId, subject: 'Updated canonical call' }, harness.ctx)
    await tool.handler({ operation: 'delete', activityId }, harness.ctx)
    expect(mockOperations.map((operation) => operation.path)).toEqual(['/customers/interactions', '/customers/interactions', '/customers/interactions'])
    expect(mockRunnerContexts.every((context) => context.tool?.requiredFeatures?.join() === 'customers.interactions.manage')).toBe(true)
    expect(mockRunnerContexts.every((context) => context.userFeatures === harness.ctx.userFeatures)).toBe(true)
    expect(tool.requiredFeatures).toEqual(['customers.activities.manage'])
  })

  it('requires canonical management access before constructing the canonical runner', async () => {
    mockFlags.legacyAdapters = false
    const harness = makeHarness()
    harness.ctx.userFeatures = ['customers.activities.manage']
    await expect(findTool('customers.manage_record_activity').handler({ operation: 'create', personId: PERSON_ID, activityType: 'call' }, harness.ctx)).rejects.toThrow(/permission/i)
    expect(mockRunnerContexts).toHaveLength(0)
    expect(harness.commandBus.execute).not.toHaveBeenCalled()
  })

  it('accepts wildcard canonical permissions without changing the caller grants', async () => {
    mockFlags.legacyAdapters = false
    const harness = makeHarness()
    harness.ctx.userFeatures = ['customers.*']
    const result = asRecord(await findTool('customers.manage_record_activity').handler({ operation: 'create', personId: PERSON_ID, activityType: 'call' }, harness.ctx))
    expect(harness.interactions.has(String(result.activityId))).toBe(true)
    expect(mockRunnerContexts).toHaveLength(1)
    expect(mockRunnerContexts[0].userFeatures).toBe(harness.ctx.userFeatures)
    expect(mockRunnerContexts[0].tool?.requiredFeatures).toEqual(['customers.interactions.manage'])
  })
})

describe('bounded activity pagination', () => {
  it.each([
    { unified: true, legacyAdapters: true },
    { unified: false, legacyAdapters: false },
    { unified: false, legacyAdapters: true },
  ])('bounds hydration at a million-row offset with flags %j', async (flags) => {
    mockFlags = { ...mockFlags, ...flags }
    const harness = makeHarness()
    const originalRead = mockRead
    const sourceTotal = 1_000_010
    const offset = 1_000_001
    const includeLegacy = !flags.unified && flags.legacyAdapters
    harness.em.count.mockImplementation(async () => sourceTotal)
    mockRead = (entity, where, options = {}) => {
      if (entity !== CustomerInteraction && entity !== CustomerActivity) return originalRead(entity, where, options)
      expect(options.limit).toBeLessThanOrEqual(1)
      const index = options.offset ?? 0
      if (index >= sourceTotal) return []
      const legacy = entity === CustomerActivity
      return [Object.assign(legacy ? new CustomerActivity() : new CustomerInteraction(), {
        id: `88888888-8888-4888-8888-${String(index).padStart(12, '0')}`,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        interactionType: 'call',
        activityType: 'call',
        title: `Canonical ${index}`,
        subject: `Legacy ${index}`,
        occurredAt: new Date(INITIAL_DATE.getTime() - (index * 2 + Number(legacy)) * 1000),
        createdAt: INITIAL_DATE,
        updatedAt: INITIAL_DATE,
      })]
    }
    const page = asRecord(await findTool('customers.list_activities').handler({ offset, limit: 1 }, harness.ctx))
    expect(page.total).toBe(sourceTotal * (includeLegacy ? 2 : 1))
    expect(page.items).toEqual([expect.objectContaining({
      subject: includeLegacy ? 'Legacy 500000' : `Canonical ${offset}`,
    })])
    expect(mockActivityReads.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(offset + 1)) + 2)
    if (!includeLegacy) expect(mockActivityReads).toEqual([expect.objectContaining({ offset, limit: 1 })])
  })

  it.each(['CCCCLLLL', 'LLLLCCCC', 'CLCLCLCL', 'LCCLLCLC', 'CLLLLLLL', 'CCCCCCCL', 'CCCCCCCC', 'LLLLLLLL'])(
    'preserves merged page boundaries for timeline %s', async (sources) => {
      const harness = makeHarness()
      const expectedIds: string[] = []
      for (const [index, source] of [...sources].entries()) {
        const id = `99999999-9999-4999-8999-${String(sources.length - index).padStart(12, '0')}`
        const occurredAt = index < 4 ? INITIAL_DATE : null
        const createdAt = index < 6 ? INITIAL_DATE : new Date(INITIAL_DATE.getTime() - 1000)
        if (source === 'L') {
          seedLegacy(harness, { id, occurredAt, createdAt })
        } else {
          harness.interactions.set(id, Object.assign(new CustomerInteraction(), {
            id, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID,
            entity: harness.person, interactionType: 'call', source: 'adapter:activity',
            title: `Canonical ${index}`, occurredAt, createdAt, updatedAt: INITIAL_DATE, deletedAt: null,
          }))
        }
        expectedIds.push(id)
      }
      const list = findTool('customers.list_activities')
      for (const offset of [0, 1, 2, 3, 4, 5, 6, 7, 8, 1000000]) {
        const page = asRecord(await list.handler({ offset, limit: 2 }, harness.ctx))
        expect(page.total).toBe(sources.length)
        expect((page.items as Row[]).map((item) => item.id)).toEqual(expectedIds.slice(offset, offset + 2))
      }
      expect(mockActivityReads.every((options) => (options.limit ?? 0) <= 2)).toBe(true)
    },
  )
})

describe('historical activities and canonical authority', () => {
  it('hides another author’s private canonical email from ordinary, superadmin and API-key callers', async () => {
    const harness = makeHarness()
    const tool = findTool('customers.manage_record_activity')
    const created = asRecord(await tool.handler({ operation: 'create', personId: PERSON_ID, activityType: 'email', subject: 'Private email', occurredAt: OCCURRED_AT }, harness.ctx))
    const activityId = String(created.activityId)
    const email = harness.interactions.get(activityId)
    if (!email) throw new Error('Expected persisted email')
    email.visibility = 'private'
    email.authorUserId = 'mailbox-owner'
    seedLegacy(harness, { id: activityId, activityType: 'email', subject: 'Stale private email' })
    mockOperations.length = 0

    for (const caller of [
      { userId: 'another-user', isSuperAdmin: false },
      { userId: 'another-user', isSuperAdmin: true },
      { userId: 'api_key:mailbox-owner', isSuperAdmin: true },
    ]) {
      const ctx = { ...harness.ctx, ...caller, userFeatures: ['*'] }
      expect(asRecord(await findTool('customers.list_activities').handler({}, ctx))).toMatchObject({ items: [], total: 0 })
      expect(await tool.loadBeforeRecord?.({ operation: 'update', activityId }, ctx)).toBeNull()
      await expect(tool.handler({ operation: 'delete', activityId }, ctx)).rejects.toThrow(/not accessible/)
    }
    expect(mockOperations).toHaveLength(0)
    const owner = { ...harness.ctx, userId: 'mailbox-owner' }
    expect(asRecord(await findTool('customers.list_activities').handler({}, owner))).toMatchObject({ items: [expect.objectContaining({ id: activityId, subject: 'Private email' })], total: 1 })
  })

  it('paginates a mixed canonical and legacy timeline with an accurate total and scoped duplicate suppression', async () => {
    const harness = makeHarness()
    const tool = findTool('customers.manage_record_activity')
    seedLegacy(harness)
    const unbridgedId = '99999999-9999-4999-8999-999999999999'
    seedLegacy(harness, { id: unbridgedId, subject: 'Newest legacy call', occurredAt: new Date('2026-10-04T11:00:00.000Z') })
    harness.interactions.set(unbridgedId, Object.assign(new CustomerInteraction(), {
      id: unbridgedId,
      tenantId: OTHER_TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entity: harness.person,
      interactionType: 'call',
      title: 'Foreign canonical row',
      source: 'adapter:activity',
      occurredAt: INITIAL_DATE,
      createdAt: INITIAL_DATE,
      updatedAt: INITIAL_DATE,
    }))
    const canonicalIds: string[] = []
    for (const day of ['03', '02']) {
      const created = asRecord(await tool.handler({ operation: 'create', personId: PERSON_ID, activityType: 'call', subject: `Canonical call ${day}`, occurredAt: `2026-10-${day}T11:00:00.000Z` }, harness.ctx))
      canonicalIds.push(String(created.activityId))
    }
    await tool.handler({ operation: 'update', activityId: LEGACY_ID, activityType: 'meeting', subject: 'Updated meeting' }, harness.ctx)
    const list = findTool('customers.list_activities')
    const page = asRecord(await list.handler({ personId: PERSON_ID, offset: 1, limit: 2 }, harness.ctx))
    expect(page).toMatchObject({ total: 4, offset: 1, limit: 2 })
    expect((page.items as Row[]).map((item) => item.id)).toEqual(canonicalIds)
    const calls = asRecord(await list.handler({ personId: PERSON_ID, activityType: 'call' }, harness.ctx))
    expect(calls.total).toBe(3)
    expect((calls.items as Row[]).map((item) => item.id)).toEqual([unbridgedId, ...canonicalIds])
    expect(harness.em.createQueryBuilder).toHaveBeenCalledWith(CustomerInteraction)
  })

  it('bridges a legacy activity, returns current values and never revives stale legacy values after deletion', async () => {
    const harness = makeHarness()
    seedLegacy(harness)
    const tool = findTool('customers.manage_record_activity')
    expect(asRecord(await findTool('customers.list_activities').handler({ personId: PERSON_ID, activityType: 'call' }, harness.ctx))).toMatchObject({ items: [expect.objectContaining({ id: LEGACY_ID, subject: 'Historical call' })], total: 1 })
    expect(await tool.loadBeforeRecord?.({ operation: 'update', activityId: LEGACY_ID }, harness.ctx)).toMatchObject({ entityType: 'customers.customer_activity', before: { subject: 'Historical call' } })

    const updated = asRecord(await tool.handler({ operation: 'update', activityId: LEGACY_ID, activityType: 'meeting', subject: 'Current meeting' }, harness.ctx))
    expect(updated.before).toMatchObject({ activityType: 'call', subject: 'Historical call' })
    expect(updated.after).toMatchObject({ activityType: 'meeting', subject: 'Current meeting' })
    expect(harness.legacy.get(LEGACY_ID)?.subject).toBe('Historical call')
    expect(asRecord(await findTool('customers.list_activities').handler({ activityType: 'call' }, harness.ctx))).toMatchObject({ items: [], total: 0 })
    expect(asRecord(await findTool('customers.list_activities').handler({ activityType: 'meeting' }, harness.ctx))).toMatchObject({ items: [expect.objectContaining({ id: LEGACY_ID, subject: 'Current meeting' })], total: 1 })
    expect(await tool.loadBeforeRecord?.({ operation: 'delete', activityId: LEGACY_ID }, harness.ctx)).toMatchObject({ entityType: 'customers.customer_interaction', before: { subject: 'Current meeting' } })

    await tool.handler({ operation: 'delete', activityId: LEGACY_ID }, harness.ctx)
    expect(asRecord(await findTool('customers.list_activities').handler({}, harness.ctx))).toMatchObject({ items: [], total: 0 })
    expect(await tool.loadBeforeRecord?.({ operation: 'delete', activityId: LEGACY_ID }, harness.ctx)).toBeNull()
  })

  it('keeps tenant and organization filters on list and before-record reads', async () => {
    const harness = makeHarness()
    seedLegacy(harness, { tenantId: OTHER_TENANT_ID })
    seedLegacy(harness, { id: '99999999-9999-4999-8999-999999999999', organizationId: OTHER_ORGANIZATION_ID })
    const tool = findTool('customers.manage_record_activity')
    expect(asRecord(await findTool('customers.list_activities').handler({}, harness.ctx))).toMatchObject({ items: [], total: 0 })
    expect(await tool.loadBeforeRecord?.({ operation: 'update', activityId: LEGACY_ID }, harness.ctx)).toBeNull()
    await expect(tool.handler({ operation: 'delete', activityId: LEGACY_ID }, harness.ctx)).rejects.toThrow(/not accessible/)
    expect(harness.commandBus.execute).not.toHaveBeenCalled()
  })
})
