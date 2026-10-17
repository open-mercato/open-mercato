import fs from 'node:fs'
import path from 'node:path'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silentLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: () => silentLogger,
  }
  return { ...actual, createLogger: () => silentLogger }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: FinderLike, entityClass: unknown, filters: unknown, options?: unknown) =>
    em.find(entityClass, filters, options),
  findOneWithDecryption: (em: FinderLike, entityClass: unknown, filters: unknown, options?: unknown) =>
    em.findOne(entityClass, filters, options),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: async () => ({}),
}))

import { asValue, createContainer, InjectionMode } from 'awilix'
import '@open-mercato/core/modules/customers/commands'
import { CommandBus, type CommandRuntimeContext, type CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  SIMULATION_EVENT_ID_PATTERN,
  type SimulationAuditEntry,
  type SimulationEventAdapter,
  type SimulationEventPayload,
} from '@open-mercato/shared/modules/insights/simulate'
import { deriveActionLogActionType } from '@open-mercato/core/modules/audit_logs/lib/projections'
import simulateConfigDefault, { simulateConfig } from '../insights.simulate'
import { CustomerCompanyProfile, CustomerDeal, CustomerEntity, CustomerPersonProfile } from '../data/entities'

type FinderLike = {
  find: (entityClass: unknown, filters: unknown, options?: unknown) => Promise<unknown>
  findOne: (entityClass: unknown, filters: unknown, options?: unknown) => Promise<unknown>
}

type CapturedEmit = {
  event: string
  payload: Record<string, unknown>
  options: Record<string, unknown> | undefined
}

type LoggedAction = {
  commandId: string
  actionLabel?: string
  resourceKind?: string
  resourceId?: string
  tenantId?: string
  organizationId?: string
  actorUserId?: string
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changes?: Record<string, unknown>
  context?: Record<string, unknown>
  commandPayload?: unknown
}

type HarnessSetup = {
  records?: Array<[unknown, Record<string, unknown>]>
  syncOrigin?: string | null
}

type Harness = {
  ctx: CommandRuntimeContext
  emits: CapturedEmit[]
  logged: LoggedAction[]
  traces: LoggedAction[]
  setUndoSource: (source: CommandUndoLogEntry) => void
}

type Claim = {
  eventId: string
  result: SimulationEventPayload
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ACTOR_ID = '33333333-3333-4333-8333-333333333333'
const PERSON_ENTITY_ID = '44444444-4444-4444-8444-444444444444'
const CREATED_ENTITY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const PERSON_PROFILE_ID = '55555555-5555-4555-8555-555555555555'
const COMPANY_ENTITY_ID = '66666666-6666-4666-8666-666666666666'
const COMPANY_PROFILE_ID = '77777777-7777-4777-8777-777777777777'
const DEAL_ID = '88888888-8888-4888-8888-888888888888'
const OWNER_ID = '99999999-9999-4999-8999-999999999999'
const OTHER_ORG_ID = 'abababab-abab-4bab-8bab-abababababab'
const LOG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE_LOG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const UNDO_TOKEN = 'undo-token-1'
const AT = '2026-10-09T10:00:00.000Z'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const
const TRACKED_CLASSES: unknown[] = [CustomerEntity, CustomerPersonProfile, CustomerCompanyProfile, CustomerDeal]
const GENERATED_IDS = new Map<unknown, string>([
  [CustomerEntity, CREATED_ENTITY_ID],
  [CustomerPersonProfile, PERSON_PROFILE_ID],
  [CustomerCompanyProfile, COMPANY_PROFILE_ID],
  [CustomerDeal, DEAL_ID],
])

const EXPECTED_EVENT_IDS = [
  'customers.person.created',
  'customers.person.updated',
  'customers.person.deleted',
  'customers.company.created',
  'customers.company.updated',
  'customers.company.deleted',
  'customers.deal.created',
  'customers.deal.updated',
  'customers.deal.deleted',
  'customers.deal.won',
  'customers.deal.lost',
]

const ACTION_LABEL_KEYS: Record<string, string> = {
  'customers.people.create': 'customers.audit.people.create',
  'customers.people.update': 'customers.audit.people.update',
  'customers.people.delete': 'customers.audit.people.delete',
  'customers.companies.create': 'customers.audit.companies.create',
  'customers.companies.update': 'customers.audit.companies.update',
  'customers.companies.delete': 'customers.audit.companies.delete',
  'customers.deals.create': 'customers.audit.deals.create',
  'customers.deals.update': 'customers.audit.deals.update',
  'customers.deals.delete': 'customers.audit.deals.delete',
}

function adapters(): SimulationEventAdapter[] {
  return simulateConfig.eventAdapters ?? []
}

function adapterFor(eventId: string): SimulationEventAdapter {
  const adapter = adapters().find((candidate) => candidate.eventId === eventId)
  if (!adapter) throw new Error(`[internal] missing adapter ${eventId}`)
  return adapter
}

function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8'))
}

function toStored(value: unknown): unknown {
  if (value === undefined || value === null) return null
  return JSON.parse(JSON.stringify(value))
}

function createKyselyStub() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'selectAll', 'where', 'orderBy', 'limit', 'offset', 'values', 'set', 'onConflict', 'returning']) {
    chain[method] = () => chain
  }
  chain.executeTakeFirst = async () => undefined
  chain.execute = async () => []
  return {
    selectFrom: () => chain,
    insertInto: () => chain,
    updateTable: () => chain,
    deleteFrom: () => chain,
  }
}

function createHarness(setup: HarnessSetup = {}): Harness {
  const store = new Map<unknown, Record<string, unknown>>(setup.records ?? [])
  const em: Record<string, unknown> = {}
  Object.assign(em, {
    fork: () => em,
    findOne: async (entityClass: unknown) => store.get(entityClass) ?? null,
    find: async () => [],
    count: async () => 0,
    nativeDelete: async () => 0,
    nativeUpdate: async () => 0,
    remove: (record: unknown) => {
      for (const [entityClass, stored] of store) {
        if (stored === record) store.delete(entityClass)
      }
    },
    flush: async () => undefined,
    persist: () => undefined,
    transactional: async (work: (inner: unknown) => Promise<unknown>) => work(em),
    begin: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    isInTransaction: () => false,
    create: (entityClass: unknown, data: Record<string, unknown>) => {
      const record: Record<string, unknown> = { id: GENERATED_IDS.get(entityClass) ?? 'generated-id', ...data }
      if (TRACKED_CLASSES.includes(entityClass)) store.set(entityClass, record)
      return record
    },
    getReference: (_entityClass: unknown, id: unknown) => ({ id }),
    getKysely: () => createKyselyStub(),
  })
  const emits: CapturedEmit[] = []
  const logged: LoggedAction[] = []
  const traces: LoggedAction[] = []
  let undoSource: CommandUndoLogEntry | null = null
  const eventBus = {
    emitEvent: async (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
      emits.push({ event, payload: { ...payload }, options })
    },
  }
  const actionLogService = {
    log: async (payload: LoggedAction) => {
      logged.push(payload)
      return { id: LOG_ID, ...payload }
    },
    findByUndoToken: async () => undoSource,
    claimForUndo: async () => true,
    releaseUndoClaim: async () => undefined,
    markUndone: async (_id: string, trace?: LoggedAction) => {
      if (trace) traces.push(trace)
      return null
    },
  }
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  const dataEngine = new DefaultDataEngine(em as unknown as EntityManager, container)
  dataEngine.setCustomFields = async () => undefined
  container.register({
    em: asValue(em),
    dataEngine: asValue(dataEngine),
    eventBus: asValue(eventBus),
    actionLogService: asValue(actionLogService),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: null,
    syncOrigin: setup.syncOrigin ?? null,
  }
  return {
    ctx,
    emits,
    logged,
    traces,
    setUndoSource: (source) => {
      undoSource = source
    },
  }
}

async function runCommand(harness: Harness, commandId: string, input: unknown): Promise<LoggedAction> {
  await new CommandBus().execute(commandId, { input, ctx: harness.ctx })
  const entry = harness.logged.at(-1)
  if (!entry || entry.commandId !== commandId) throw new Error(`[internal] ${commandId} wrote no audit entry`)
  return entry
}

async function undoCommand(harness: Harness, source: LoggedAction): Promise<LoggedAction> {
  harness.emits.length = 0
  harness.setUndoSource({
    id: SOURCE_LOG_ID,
    commandId: source.commandId,
    commandPayload: toStored(source.commandPayload),
    snapshotBefore: toStored(source.snapshotBefore),
    snapshotAfter: toStored(source.snapshotAfter),
    resourceKind: source.resourceKind ?? null,
    resourceId: source.resourceId ?? null,
    undoToken: UNDO_TOKEN,
    actionLabel: source.actionLabel ?? null,
    tenantId: source.tenantId ?? null,
    organizationId: source.organizationId ?? null,
    actorUserId: source.actorUserId ?? null,
    changesJson: (toStored(source.changes) as Record<string, unknown> | null) ?? null,
    contextJson: (toStored(source.context) as Record<string, unknown> | null) ?? null,
  })
  await new CommandBus().undo(UNDO_TOKEN, harness.ctx)
  const trace = harness.traces.at(-1)
  if (!trace) throw new Error(`[internal] undo of ${source.commandId} wrote no trace entry`)
  return trace
}

function toAuditEntry(logged: LoggedAction, overrides: Partial<SimulationAuditEntry> = {}): SimulationAuditEntry {
  return {
    logId: LOG_ID,
    at: AT,
    commandId: logged.commandId,
    actionType: deriveActionLogActionType({ commandId: logged.commandId, actionLabel: logged.actionLabel ?? null }),
    executionState: 'done',
    actorUserId: logged.actorUserId ?? null,
    resourceKind: logged.resourceKind ?? null,
    resourceId: logged.resourceId ?? null,
    snapshotBefore: toStored(logged.snapshotBefore),
    snapshotAfter: toStored(logged.snapshotAfter),
    changes: (toStored(logged.changes) as Record<string, unknown> | null) ?? null,
    causeKind: 'user',
    organizationId: logged.organizationId ?? null,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

function buildEntry(overrides: Partial<SimulationAuditEntry>): SimulationAuditEntry {
  return {
    logId: LOG_ID,
    at: AT,
    commandId: null,
    actionType: null,
    executionState: 'done',
    actorUserId: ACTOR_ID,
    resourceKind: null,
    resourceId: null,
    snapshotBefore: null,
    snapshotAfter: null,
    changes: null,
    causeKind: 'user',
    organizationId: ORG_ID,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

function claimedEvents(entry: SimulationAuditEntry): Claim[] {
  const claims: Claim[] = []
  for (const adapter of adapters()) {
    if (entry.resourceKind === null || !adapter.logResourceKinds.includes(entry.resourceKind)) continue
    if (entry.actionType === null || !adapter.actionTypes.includes(entry.actionType)) continue
    if (adapter.commandIds && (entry.commandId === null || !adapter.commandIds.includes(entry.commandId))) continue
    const result = adapter.payloadFrom(entry, { scope: SCOPE })
    if (result) claims.push({ eventId: adapter.eventId, result })
  }
  return claims.sort((left, right) => left.eventId.localeCompare(right.eventId))
}

function declaredEmits(emits: CapturedEmit[]): CapturedEmit[] {
  return emits
    .filter((emit) => EXPECTED_EVENT_IDS.includes(emit.event))
    .sort((left, right) => left.event.localeCompare(right.event))
}

function withoutPaths(payload: Record<string, unknown>, paths: string[] = []): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !paths.includes(key)))
}

function expectClaimsToMirrorEmits(entry: SimulationAuditEntry, emits: CapturedEmit[]): Claim[] {
  const claims = claimedEvents(entry)
  const emitted = declaredEmits(emits)
  expect(claims.map((claim) => claim.eventId)).toEqual(emitted.map((emit) => emit.event))
  claims.forEach((claim, index) => {
    const unknownPaths = claim.result.unknownPaths ?? []
    for (const unknownPath of unknownPaths) expect(claim.result.payload).not.toHaveProperty(unknownPath)
    expect(claim.result.payload).toEqual(withoutPaths(emitted[index].payload, unknownPaths))
  })
  return claims
}

function personRecords(): Array<[unknown, Record<string, unknown>]> {
  const entity: Record<string, unknown> = {
    id: PERSON_ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'person',
    displayName: 'Jane Doe',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  }
  const profile: Record<string, unknown> = {
    id: PERSON_PROFILE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    firstName: 'Jane',
    lastName: 'Doe',
    preferredName: null,
    jobTitle: null,
    department: null,
    seniority: null,
    timezone: null,
    linkedInUrl: null,
    twitterUrl: null,
    company: null,
  }
  return [
    [CustomerEntity, entity],
    [CustomerPersonProfile, profile],
  ]
}

function companyRecords(): Array<[unknown, Record<string, unknown>]> {
  const entity: Record<string, unknown> = {
    id: COMPANY_ENTITY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'company',
    displayName: 'Acme',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  }
  const profile: Record<string, unknown> = {
    id: COMPANY_PROFILE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    entity,
    legalName: 'Acme Ltd',
    brandName: null,
    domain: null,
    websiteUrl: null,
    industry: null,
    sizeBucket: null,
    annualRevenue: null,
  }
  return [
    [CustomerEntity, entity],
    [CustomerCompanyProfile, profile],
  ]
}

function dealRecords(overrides: Record<string, unknown> = {}): Array<[unknown, Record<string, unknown>]> {
  return [
    [
      CustomerDeal,
      {
        id: DEAL_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        title: 'Expansion renewal',
        description: null,
        status: 'open',
        pipelineStage: null,
        pipelineId: null,
        pipelineStageId: null,
        valueAmount: '12345.67',
        valueCurrency: 'USD',
        probability: 40,
        expectedCloseAt: null,
        ownerUserId: OWNER_ID,
        source: null,
        closureOutcome: null,
        lossReasonId: null,
        lossNotes: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        ...overrides,
      },
    ],
  ]
}

function storedNumeric(value: unknown): unknown {
  return typeof value === 'string' ? Number(value).toFixed(2) : value
}

function withStoredDealAmounts(entry: SimulationAuditEntry): SimulationAuditEntry {
  const normalize = (snapshot: unknown): unknown => {
    if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return snapshot
    const graph = snapshot as Record<string, unknown>
    const deal = graph.deal as Record<string, unknown> | undefined
    if (!deal) return snapshot
    return { ...graph, deal: { ...deal, valueAmount: storedNumeric(deal.valueAmount) } }
  }
  return { ...entry, snapshotBefore: normalize(entry.snapshotBefore), snapshotAfter: normalize(entry.snapshotAfter) }
}

describe('customers insights.simulate', () => {
  describe('config shape', () => {
    it('declares version 1 and exports the same config as default', () => {
      expect(simulateConfig.version).toBe(1)
      expect(simulateConfigDefault).toBe(simulateConfig)
      expect(simulateConfig.kinds).toBeUndefined()
    })

    it('declares exactly the person, company and deal events with unique valid ids', () => {
      const eventIds = adapters().map((adapter) => adapter.eventId)
      expect(eventIds).toEqual(EXPECTED_EVENT_IDS)
      expect(new Set(eventIds).size).toBe(eventIds.length)
      for (const eventId of eventIds) expect(eventId).toMatch(SIMULATION_EVENT_ID_PATTERN)
    })

    it('maps every event to the audit resource kind and the commands that emit it, undo included', () => {
      const describeAdapter = (adapter: SimulationEventAdapter) => [
        adapter.eventId,
        adapter.logResourceKinds,
        adapter.actionTypes,
        adapter.commandIds,
      ]
      expect(adapters().map(describeAdapter)).toEqual([
        ['customers.person.created', ['customers.person'], ['create', 'delete'], ['customers.people.create', 'customers.people.delete']],
        ['customers.person.updated', ['customers.person'], ['edit'], ['customers.people.update']],
        ['customers.person.deleted', ['customers.person'], ['create', 'delete'], ['customers.people.create', 'customers.people.delete']],
        ['customers.company.created', ['customers.company'], ['create', 'delete'], ['customers.companies.create', 'customers.companies.delete']],
        ['customers.company.updated', ['customers.company'], ['edit'], ['customers.companies.update']],
        ['customers.company.deleted', ['customers.company'], ['create', 'delete'], ['customers.companies.create', 'customers.companies.delete']],
        ['customers.deal.created', ['customers.deal'], ['create', 'delete'], ['customers.deals.create', 'customers.deals.delete']],
        ['customers.deal.updated', ['customers.deal'], ['edit'], ['customers.deals.update']],
        ['customers.deal.deleted', ['customers.deal'], ['delete'], ['customers.deals.delete']],
        ['customers.deal.won', ['customers.deal'], ['edit'], ['customers.deals.update']],
        ['customers.deal.lost', ['customers.deal'], ['edit'], ['customers.deals.update']],
      ])
    })

    it('declares the action types the audit projection derives for those commands in every locale', () => {
      for (const locale of LOCALES) {
        const messages = loadLocale(locale)
        for (const adapter of adapters()) {
          const derived = (adapter.commandIds ?? []).map((commandId) =>
            deriveActionLogActionType({ commandId, actionLabel: messages[ACTION_LABEL_KEYS[commandId]] }),
          )
          expect(new Set(derived)).toEqual(new Set(adapter.actionTypes))
        }
      }
    })
  })

  describe('person events mirror commands/people.ts', () => {
    it('claims customers.person.created with the profile id and entity id the create command emits', async () => {
      const harness = createHarness()
      const logged = await runCommand(harness, 'customers.people.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        firstName: 'Jane',
        lastName: 'Doe',
      })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims).toEqual([
        {
          eventId: 'customers.person.created',
          result: {
            payload: { id: PERSON_PROFILE_ID, entityId: CREATED_ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
          },
        },
      ])
      expect(declaredEmits(harness.emits)[0].options).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
    })

    it('claims customers.person.updated for the update command', async () => {
      const harness = createHarness({ records: personRecords() })
      const logged = await runCommand(harness, 'customers.people.update', { id: PERSON_ENTITY_ID, firstName: 'Janina' })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.person.updated'])
    })

    it('claims customers.person.deleted for the delete command', async () => {
      const harness = createHarness({ records: personRecords() })
      const logged = await runCommand(harness, 'customers.people.delete', { body: { id: PERSON_ENTITY_ID } })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.person.deleted'])
    })

    it('marks syncOrigin unknown for a sync write while the rest of the payload matches', async () => {
      const harness = createHarness({ records: personRecords(), syncOrigin: 'bridge:crm' })
      const logged = await runCommand(harness, 'customers.people.update', { id: PERSON_ENTITY_ID, firstName: 'Janina' })
      expect(declaredEmits(harness.emits)[0].payload.syncOrigin).toBe('bridge:crm')
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged, { causeKind: 'sync_run' }), harness.emits)
      expect(claims[0].result.unknownPaths).toEqual(['syncOrigin'])
    })

    it('treats syncOrigin as unknown only for causes that may carry a sync origin', () => {
      const entry = buildEntry({
        commandId: 'customers.people.update',
        actionType: 'edit',
        resourceKind: 'customers.person',
        resourceId: PERSON_ENTITY_ID,
        snapshotBefore: { entity: { id: PERSON_ENTITY_ID }, profile: { id: PERSON_PROFILE_ID } },
        snapshotAfter: { entity: { id: PERSON_ENTITY_ID }, profile: { id: PERSON_PROFILE_ID } },
      })
      const adapter = adapterFor('customers.person.updated')
      const unknownFor = (causeKind: SimulationAuditEntry['causeKind']) =>
        adapter.payloadFrom({ ...entry, causeKind }, { scope: SCOPE })?.unknownPaths ?? []
      for (const causeKind of [null, 'sync_run', 'subscriber', 'schedule', 'system', 'unknown'] as const) {
        expect(unknownFor(causeKind)).toEqual(['syncOrigin'])
      }
      for (const causeKind of ['user', 'api_key', 'agent', 'workflow', 'business_rule', 'ai_action', 'ai_tool', 'undo', 'redo'] as const) {
        expect(unknownFor(causeKind)).toEqual([])
      }
    })

    it('claims customers.person.deleted for the undo trace of a create and keeps the source claim', async () => {
      const harness = createHarness()
      const logged = await runCommand(harness, 'customers.people.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        firstName: 'Jane',
        lastName: 'Doe',
      })
      const trace = await undoCommand(harness, logged)
      expect(declaredEmits(harness.emits).map((emit) => emit.event)).toEqual(['customers.person.deleted'])
      const claims = expectClaimsToMirrorEmits(toAuditEntry(trace, { causeKind: 'undo' }), harness.emits)
      expect(claims[0].result.payload).toEqual({
        id: PERSON_PROFILE_ID,
        entityId: CREATED_ENTITY_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
      const legacyTrace = claimedEvents(toAuditEntry(trace, { causeKind: null }))
      expect(legacyTrace.map((claim) => claim.eventId)).toEqual(['customers.person.deleted'])
      expect(legacyTrace[0].result.unknownPaths).toEqual(['syncOrigin'])
      const undoneSource = claimedEvents(toAuditEntry(logged, { executionState: 'undone' }))
      expect(undoneSource.map((claim) => claim.eventId)).toEqual(['customers.person.created'])
    })

    it('leaves the profile id unknown when no snapshot carries it', () => {
      const result = adapterFor('customers.person.deleted').payloadFrom(
        buildEntry({
          commandId: 'customers.people.delete',
          actionType: 'delete',
          resourceKind: 'customers.person',
          resourceId: PERSON_ENTITY_ID,
          snapshotBefore: { entity: { id: PERSON_ENTITY_ID } },
        }),
        { scope: SCOPE },
      )
      expect(result).toEqual({
        payload: { entityId: PERSON_ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        unknownPaths: ['id'],
      })
    })
  })

  describe('company events mirror commands/companies.ts', () => {
    it('claims customers.company.created without syncOrigin', async () => {
      const harness = createHarness({ syncOrigin: 'bridge:crm' })
      const logged = await runCommand(harness, 'customers.companies.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        displayName: 'Acme',
      })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged, { causeKind: 'sync_run' }), harness.emits)
      expect(claims).toEqual([
        {
          eventId: 'customers.company.created',
          result: {
            payload: { id: COMPANY_PROFILE_ID, entityId: CREATED_ENTITY_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
          },
        },
      ])
    })

    it('claims customers.company.updated for the update command', async () => {
      const harness = createHarness({ records: companyRecords() })
      const logged = await runCommand(harness, 'customers.companies.update', { id: COMPANY_ENTITY_ID, displayName: 'Acme Group' })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.company.updated'])
      expect(claims[0].result.payload).toEqual({
        id: COMPANY_PROFILE_ID,
        entityId: COMPANY_ENTITY_ID,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      })
    })

    it('claims customers.company.deleted for the delete command', async () => {
      const harness = createHarness({ records: companyRecords() })
      const logged = await runCommand(harness, 'customers.companies.delete', { body: { id: COMPANY_ENTITY_ID } })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.company.deleted'])
    })

    it('claims customers.company.deleted for the undo trace of a create', async () => {
      const harness = createHarness()
      const logged = await runCommand(harness, 'customers.companies.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        displayName: 'Acme',
      })
      const trace = await undoCommand(harness, logged)
      const claims = expectClaimsToMirrorEmits(toAuditEntry(trace, { causeKind: 'undo' }), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.company.deleted'])
    })
  })

  describe('deal events mirror commands/deals.ts', () => {
    it('claims customers.deal.created for the create command', async () => {
      const harness = createHarness()
      const logged = await runCommand(harness, 'customers.deals.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        title: 'Expansion renewal',
      })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims).toEqual([
        {
          eventId: 'customers.deal.created',
          result: { payload: { id: DEAL_ID, organizationId: ORG_ID, tenantId: TENANT_ID } },
        },
      ])
    })

    it('claims nothing for the undo trace of a deal create, which emits no event', async () => {
      const harness = createHarness()
      const logged = await runCommand(harness, 'customers.deals.create', {
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        title: 'Expansion renewal',
      })
      const trace = await undoCommand(harness, logged)
      expect(declaredEmits(harness.emits)).toEqual([])
      expect(claimedEvents(toAuditEntry(trace, { causeKind: 'undo' }))).toEqual([])
      expect(claimedEvents(toAuditEntry(trace, { causeKind: null }))).toEqual([])
    })

    it('claims customers.deal.deleted for the delete command and customers.deal.created for its undo', async () => {
      const harness = createHarness({ records: dealRecords() })
      const logged = await runCommand(harness, 'customers.deals.delete', { body: { id: DEAL_ID } })
      const deleted = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(deleted.map((claim) => claim.eventId)).toEqual(['customers.deal.deleted'])
      const trace = await undoCommand(harness, logged)
      const restored = expectClaimsToMirrorEmits(toAuditEntry(trace, { causeKind: 'undo' }), harness.emits)
      expect(restored.map((claim) => claim.eventId)).toEqual(['customers.deal.created'])
      const legacy = claimedEvents(toAuditEntry(trace, { causeKind: null }))
      expect(legacy.map((claim) => claim.eventId)).toEqual(['customers.deal.created'])
    })

    it('claims only customers.deal.updated when the status does not change', async () => {
      const harness = createHarness({ records: dealRecords() })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, title: 'Renamed' })
      const claims = expectClaimsToMirrorEmits(toAuditEntry(logged), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.deal.updated'])
    })

    it('claims customers.deal.won with the closing payload for a status change to win', async () => {
      const harness = createHarness({ records: dealRecords() })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, status: 'win' })
      const claims = expectClaimsToMirrorEmits(withStoredDealAmounts(toAuditEntry(logged)), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.deal.updated', 'customers.deal.won'])
      expect(claims[1].result).toEqual({
        payload: {
          id: DEAL_ID,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
          ownerUserId: OWNER_ID,
          title: 'Expansion renewal',
          valueAmount: '12345.67',
          valueCurrency: 'USD',
        },
        valuePaths: ['ownerUserId', 'title', 'valueAmount', 'valueCurrency'],
      })
      const won = declaredEmits(harness.emits).find((emit) => emit.event === 'customers.deal.won')
      expect(won?.options).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
    })

    it('claims customers.deal.lost for the legacy loose status', async () => {
      const harness = createHarness({ records: dealRecords() })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, status: 'loose' })
      const claims = expectClaimsToMirrorEmits(withStoredDealAmounts(toAuditEntry(logged)), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.deal.lost', 'customers.deal.updated'])
    })

    it('fires again when the raw status changes between two spellings of the same outcome', async () => {
      const harness = createHarness({ records: dealRecords({ status: 'win' }) })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, status: 'won' })
      const claims = expectClaimsToMirrorEmits(withStoredDealAmounts(toAuditEntry(logged)), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.deal.updated', 'customers.deal.won'])
    })

    it('uses the input form of an amount the closing update changed', async () => {
      const harness = createHarness({ records: dealRecords() })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, status: 'won', valueAmount: 15000 })
      const claims = expectClaimsToMirrorEmits(withStoredDealAmounts(toAuditEntry(logged)), harness.emits)
      expect(claims[1].result.payload.valueAmount).toBe('15000')
      expect(claims[1].result.unknownPaths).toBeUndefined()
    })

    it('leaves an unchanged stored amount unknown when the emitted form depends on the input', async () => {
      const statusOnly = createHarness({ records: dealRecords({ valueAmount: '12000.00' }) })
      const statusOnlyLog = await runCommand(statusOnly, 'customers.deals.update', { id: DEAL_ID, status: 'won' })
      const resent = createHarness({ records: dealRecords({ valueAmount: '12000.00' }) })
      const resentLog = await runCommand(resent, 'customers.deals.update', { id: DEAL_ID, status: 'won', valueAmount: 12000 })
      const emittedAmount = (harness: Harness) =>
        declaredEmits(harness.emits).find((emit) => emit.event === 'customers.deal.won')?.payload.valueAmount
      expect(emittedAmount(statusOnly)).toBe('12000.00')
      expect(emittedAmount(resent)).toBe('12000')
      for (const [harness, logged] of [[statusOnly, statusOnlyLog], [resent, resentLog]] as const) {
        const claims = expectClaimsToMirrorEmits(withStoredDealAmounts(toAuditEntry(logged)), harness.emits)
        expect(claims[1].result.unknownPaths).toEqual(['valueAmount'])
      }
    })

    it('claims only customers.deal.updated for the undo trace that restores a won status', async () => {
      const harness = createHarness({ records: dealRecords({ status: 'won' }) })
      const logged = await runCommand(harness, 'customers.deals.update', { id: DEAL_ID, status: 'open' })
      const trace = await undoCommand(harness, logged)
      expect(declaredEmits(harness.emits).map((emit) => emit.event)).toEqual(['customers.deal.updated'])
      const claims = expectClaimsToMirrorEmits(toAuditEntry(trace, { causeKind: 'undo' }), harness.emits)
      expect(claims.map((claim) => claim.eventId)).toEqual(['customers.deal.updated'])
    })

    it('claims nothing for a closing update whose snapshots do not carry the statuses', () => {
      const entry = buildEntry({
        commandId: 'customers.deals.update',
        actionType: 'edit',
        resourceKind: 'customers.deal',
        resourceId: DEAL_ID,
        snapshotBefore: { deal: { id: DEAL_ID } },
        snapshotAfter: { deal: { id: DEAL_ID, status: 'won' } },
      })
      expect(adapterFor('customers.deal.won').payloadFrom(entry, { scope: SCOPE })).toBeNull()
    })

    it('leaves closing values unknown when the after snapshot does not carry them', () => {
      const entry = buildEntry({
        commandId: 'customers.deals.update',
        actionType: 'edit',
        resourceKind: 'customers.deal',
        resourceId: DEAL_ID,
        snapshotBefore: { deal: { id: DEAL_ID, status: 'open', valueAmount: null } },
        snapshotAfter: { deal: { id: DEAL_ID, status: 'lost', title: 'Renewal', valueAmount: null } },
      })
      expect(adapterFor('customers.deal.lost').payloadFrom(entry, { scope: SCOPE })).toEqual({
        payload: { id: DEAL_ID, tenantId: TENANT_ID, organizationId: ORG_ID, title: 'Renewal', valueAmount: null },
        unknownPaths: ['ownerUserId', 'valueCurrency'],
        valuePaths: ['title', 'valueAmount'],
      })
    })
  })

  describe('entry handling', () => {
    const updateEntry = buildEntry({
      commandId: 'customers.deals.update',
      actionType: 'edit',
      resourceKind: 'customers.deal',
      resourceId: DEAL_ID,
      snapshotBefore: { deal: { id: DEAL_ID, status: 'open', title: 'Renewal', ownerUserId: null, valueAmount: null, valueCurrency: null } },
      snapshotAfter: { deal: { id: DEAL_ID, status: 'won', title: 'Renewal', ownerUserId: null, valueAmount: null, valueCurrency: null } },
    })

    it('claims nothing for failed entries', () => {
      expect(claimedEvents({ ...updateEntry, executionState: 'failed' })).toEqual([])
      for (const adapter of adapters()) {
        expect(adapter.payloadFrom({ ...updateEntry, executionState: 'failed' }, { scope: SCOPE })).toBeNull()
      }
    })

    it('claims nothing for commands outside the declared command ids', () => {
      const foreign = { ...updateEntry, commandId: 'customers.deals.bulk_reassign' }
      expect(claimedEvents(foreign)).toEqual([])
      for (const adapter of adapters()) expect(adapter.payloadFrom(foreign, { scope: SCOPE })).toBeNull()
    })

    it('claims nothing without a resource id', () => {
      expect(claimedEvents({ ...updateEntry, resourceId: null })).toEqual([])
    })

    it('claims a closing update that carries no recorded cause', () => {
      expect(claimedEvents({ ...updateEntry, causeKind: null }).map((claim) => claim.eventId)).toEqual([
        'customers.deal.updated',
        'customers.deal.won',
      ])
    })

    it('takes the organization from the entry and the tenant from the run scope', () => {
      const claims = claimedEvents({ ...updateEntry, organizationId: OTHER_ORG_ID })
      for (const claim of claims) {
        expect(claim.result.payload.organizationId).toBe(OTHER_ORG_ID)
        expect(claim.result.payload.tenantId).toBe(TENANT_ID)
      }
      const fallback = claimedEvents({ ...updateEntry, organizationId: null })
      for (const claim of fallback) expect(claim.result.payload.organizationId).toBe(ORG_ID)
    })
  })
})
