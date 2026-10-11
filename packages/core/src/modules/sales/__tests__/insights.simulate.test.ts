/** @jest-environment node */

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

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/custom-fields'),
  loadCustomFieldValues: async () => ({}),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: async () => undefined,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async () => [],
  findOneWithDecryption: (em: FinderLike, entityClass: unknown, filters: unknown, options?: unknown) =>
    em.findOne(entityClass, filters, options),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createForFeature: async () => undefined }),
}))

import fs from 'node:fs'
import path from 'node:path'
import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  SIMULATION_EVENT_ID_PATTERN,
  type SimulationAuditEntry,
  type SimulationEventAdapter,
  type SimulationEventPayload,
} from '@open-mercato/shared/modules/insights/simulate'
import { deriveActionLogActionType } from '@open-mercato/core/modules/audit_logs/lib/projections'
import '../commands/documents'
import { DefaultSalesCalculationService } from '../services/salesCalculationService'
import { SalesOrder, SalesQuote } from '../data/entities'
import { DictionaryEntry } from '../../dictionaries/data/entities'
import handleCrudRuleTrigger from '../../business_rules/subscribers/crud-rule-trigger'
import simulateConfigDefault, { simulateConfig } from '../insights.simulate'

type FinderLike = {
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
  organizationId?: string
  actorUserId?: string
  snapshotBefore?: unknown
  snapshotAfter?: unknown
}

type Harness = {
  ctx: CommandRuntimeContext
  emits: CapturedEmit[]
  logged: LoggedAction[]
}

type Claim = {
  eventId: string
  result: SimulationEventPayload
}

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const ACTOR_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const DOCUMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER_ORG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const STATUS_ENTRY_ID = '12121212-1212-4212-8212-121212121212'
const LOG_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const AT = '2026-10-09T10:00:00.000Z'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const
const LIFECYCLE_EVENT_IDS = ['sales.order.confirmed', 'sales.order.cancelled']
const EXPECTED_EVENT_IDS = ['sales.order.created', 'sales.quote.created', ...LIFECYCLE_EVENT_IDS]
const LIFECYCLE_VALUE_PATHS = ['orderNumber', 'previousStatus', 'status']
const TRACKED_CLASSES: unknown[] = [SalesOrder, SalesQuote]

const ACTION_LABEL_KEYS: Record<string, string> = {
  'sales.orders.create': 'sales.audit.orders.create',
  'sales.orders.update': 'sales.audit.orders.update',
  'sales.quotes.create': 'sales.audit.quotes.create',
}

const DOCUMENT_INPUT = {
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
  currencyCode: 'USD',
  lines: [
    {
      name: 'Item',
      currencyCode: 'USD',
      quantity: 1,
      unitPriceNet: 100,
      unitPriceGross: 100,
      taxRate: 0,
      discountAmount: 0,
      discountPercent: 0,
    },
  ],
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

function createHarness(records: Array<[unknown, Record<string, unknown>]> = []): Harness {
  const store = new Map<unknown, Record<string, unknown>>(records)
  const em: Record<string, unknown> = {}
  let inTransaction = false
  Object.assign(em, {
    fork: () => em,
    create: (entityClass: unknown, data: Record<string, unknown>) => {
      const record = { ...data }
      if (TRACKED_CLASSES.includes(entityClass)) store.set(entityClass, record)
      return record
    },
    persist: () => undefined,
    find: async () => [],
    findOne: async (entityClass: unknown) => store.get(entityClass) ?? null,
    count: async () => 0,
    nativeDelete: async () => 0,
    remove: () => undefined,
    flush: async () => undefined,
    isInTransaction: () => inTransaction,
    begin: async () => {
      inTransaction = true
    },
    commit: async () => {
      inTransaction = false
    },
    rollback: async () => {
      inTransaction = false
    },
    getReference: (_entityClass: unknown, id: unknown) => ({ id }),
  })
  const emits: CapturedEmit[] = []
  const logged: LoggedAction[] = []
  const container = createContainer({ injectionMode: InjectionMode.PROXY })
  const dataEngine = new DefaultDataEngine(em as unknown as EntityManager, container)
  container.register({
    em: asValue(em),
    dataEngine: asValue(dataEngine),
    eventBus: asValue({
      emit: async () => undefined,
      emitEvent: async (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => {
        emits.push({ event, payload: { ...payload }, options })
      },
    }),
    salesCalculationService: asValue(new DefaultSalesCalculationService(null)),
    salesDocumentNumberGenerator: asValue({ generate: async () => ({ number: 'DOC-1' }) }),
    actionLogService: asValue({
      log: async (payload: LoggedAction) => {
        logged.push(payload)
        return { id: LOG_ID, ...payload }
      },
    }),
  })
  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  }
  return { ctx, emits, logged }
}

async function runCommand(harness: Harness, commandId: string, input: unknown): Promise<LoggedAction> {
  await new CommandBus().execute(commandId, { input, ctx: harness.ctx })
  const entry = harness.logged.at(-1)
  if (!entry || entry.commandId !== commandId) throw new Error(`[internal] ${commandId} wrote no audit entry`)
  return entry
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
    changes: null,
    causeKind: 'user',
    organizationId: logged.organizationId ?? null,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

function orderEntry(overrides: Partial<SimulationAuditEntry> = {}): SimulationAuditEntry {
  return {
    logId: LOG_ID,
    at: AT,
    commandId: 'sales.orders.create',
    actionType: 'create',
    executionState: 'done',
    actorUserId: ACTOR_ID,
    resourceKind: 'sales.order',
    resourceId: DOCUMENT_ID,
    snapshotBefore: null,
    snapshotAfter: { order: { id: DOCUMENT_ID, organizationId: ORG_ID, tenantId: TENANT_ID } },
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
  return claims
}

function declaredEmits(emits: CapturedEmit[]): CapturedEmit[] {
  return emits.filter((emit) => EXPECTED_EVENT_IDS.includes(emit.event))
}

describe('sales insights.simulate', () => {
  describe('config shape', () => {
    it('declares version 1 and exports the same config as default', () => {
      expect(simulateConfig.version).toBe(1)
      expect(simulateConfigDefault).toBe(simulateConfig)
      expect(simulateConfig.kinds).toBeUndefined()
    })

    it('declares the created events of orders and quotes and the order lifecycle events with unique valid ids', () => {
      const eventIds = adapters().map((adapter) => adapter.eventId)
      expect(eventIds).toEqual(EXPECTED_EVENT_IDS)
      expect(new Set(eventIds).size).toBe(eventIds.length)
      for (const eventId of eventIds) expect(eventId).toMatch(SIMULATION_EVENT_ID_PATTERN)
    })

    it('narrows each event to the commands that emit it and its audit resource kind', () => {
      expect(adapters().map((adapter) => [adapter.eventId, adapter.logResourceKinds, adapter.actionTypes, adapter.commandIds])).toEqual([
        ['sales.order.created', ['sales.order'], ['create'], ['sales.orders.create']],
        ['sales.quote.created', ['sales.quote'], ['create'], ['sales.quotes.create']],
        ['sales.order.confirmed', ['sales.order'], ['create', 'edit'], ['sales.orders.create', 'sales.orders.update']],
        ['sales.order.cancelled', ['sales.order'], ['create', 'edit'], ['sales.orders.create', 'sales.orders.update']],
      ])
    })

    it('declares the action types the audit projection derives for those commands in every locale', () => {
      for (const locale of LOCALES) {
        const messages = loadLocale(locale)
        for (const adapter of adapters()) {
          const derived = (adapter.commandIds ?? []).map((commandId) =>
            deriveActionLogActionType({ commandId, actionLabel: messages[ACTION_LABEL_KEYS[commandId]] }),
          )
          expect(derived).toEqual(adapter.actionTypes)
        }
      }
    })
  })

  describe('created events mirror commands/documents.ts', () => {
    it.each([
      ['sales.orders.create', 'sales.order.created'],
      ['sales.quotes.create', 'sales.quote.created'],
    ])('%s claims %s with the payload the command emits', async (commandId, eventId) => {
      const harness = createHarness()
      const logged = await runCommand(harness, commandId, DOCUMENT_INPUT)
      const emitted = declaredEmits(harness.emits)
      expect(emitted.map((emit) => emit.event)).toEqual([eventId])
      expect(emitted[0].options).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(emitted[0].payload).toEqual({
        id: logged.resourceId,
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
        userId: ACTOR_ID,
      })
      const claims = claimedEvents(toAuditEntry(logged))
      expect(claims).toEqual([{ eventId, result: { payload: emitted[0].payload, valuePaths: ['userId'] } }])
    })
  })

  describe('order lifecycle events mirror commands/documents.ts', () => {
    function captureLifecycleEmits(): CapturedEmit[] {
      const captured: CapturedEmit[] = []
      setGlobalEventBus({
        emit: async (event: string, payload: unknown, options?: Record<string, unknown>) => {
          if (LIFECYCLE_EVENT_IDS.includes(event)) captured.push({ event, payload: payload as Record<string, unknown>, options })
        },
      })
      return captured
    }

    async function settle(): Promise<void> {
      await new Promise((resolve) => setImmediate(resolve))
    }

    function lifecycleClaims(entry: SimulationAuditEntry): Claim[] {
      return claimedEvents(entry).filter((claim) => LIFECYCLE_EVENT_IDS.includes(claim.eventId))
    }

    it('rebuilds sales.order.confirmed of an order created as confirmed, an event the rule trigger evaluates', async () => {
      const lifecycleEmits = captureLifecycleEmits()
      const harness = createHarness([[DictionaryEntry, { id: STATUS_ENTRY_ID, tenantId: TENANT_ID, value: 'confirmed' }]])
      const logged = await runCommand(harness, 'sales.orders.create', { ...DOCUMENT_INPUT, statusEntryId: STATUS_ENTRY_ID })
      await settle()
      expect(lifecycleEmits.map((emit) => emit.event)).toEqual(['sales.order.confirmed'])
      const [confirmed] = lifecycleEmits
      expect(confirmed.options).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID })
      expect(lifecycleClaims(toAuditEntry(logged))).toEqual([
        { eventId: 'sales.order.confirmed', result: { payload: confirmed.payload, valuePaths: LIFECYCLE_VALUE_PATHS } },
      ])
      const resolve = jest.fn()
      await handleCrudRuleTrigger(confirmed.payload, {
        resolve,
        eventName: 'sales.order.confirmed',
        tenantId: confirmed.options?.tenantId as string,
        organizationId: confirmed.options?.organizationId as string,
      })
      expect(resolve).toHaveBeenCalledWith('em')
    })

    it('rebuilds sales.order.cancelled of an update that moves the status to cancelled, with the previous status', async () => {
      const lifecycleEmits = captureLifecycleEmits()
      const statusEntry = { id: STATUS_ENTRY_ID, tenantId: TENANT_ID, value: 'draft' }
      const harness = createHarness([[DictionaryEntry, statusEntry]])
      const created = await runCommand(harness, 'sales.orders.create', { ...DOCUMENT_INPUT, statusEntryId: STATUS_ENTRY_ID })
      await settle()
      expect(lifecycleEmits).toEqual([])
      expect(lifecycleClaims(toAuditEntry(created))).toEqual([])
      statusEntry.value = 'cancelled'
      const updated = await runCommand(harness, 'sales.orders.update', { id: created.resourceId, statusEntryId: STATUS_ENTRY_ID })
      await settle()
      expect(lifecycleEmits.map((emit) => emit.event)).toEqual(['sales.order.cancelled'])
      const [cancelled] = lifecycleEmits
      expect(cancelled.payload).toMatchObject({ previousStatus: 'draft', status: 'cancelled' })
      expect(lifecycleClaims(toAuditEntry(updated))).toEqual([
        { eventId: 'sales.order.cancelled', result: { payload: cancelled.payload, valuePaths: LIFECYCLE_VALUE_PATHS } },
      ])
    })

    it('rebuilds nothing for an update that keeps the status', async () => {
      const lifecycleEmits = captureLifecycleEmits()
      const harness = createHarness([[DictionaryEntry, { id: STATUS_ENTRY_ID, tenantId: TENANT_ID, value: 'confirmed' }]])
      const created = await runCommand(harness, 'sales.orders.create', { ...DOCUMENT_INPUT, statusEntryId: STATUS_ENTRY_ID })
      await settle()
      lifecycleEmits.length = 0
      const updated = await runCommand(harness, 'sales.orders.update', { id: created.resourceId, statusEntryId: STATUS_ENTRY_ID })
      await settle()
      expect(lifecycleEmits).toEqual([])
      expect(lifecycleClaims(toAuditEntry(updated))).toEqual([])
    })

    it('skips undo traces, failed entries, other commands and entries without order snapshots', () => {
      const adapter = adapterFor('sales.order.cancelled')
      const transition = {
        commandId: 'sales.orders.update',
        actionType: 'edit',
        snapshotBefore: { order: { id: DOCUMENT_ID, orderNumber: 'SO-1', status: 'confirmed' } },
        snapshotAfter: { order: { id: DOCUMENT_ID, orderNumber: 'SO-1', status: 'canceled' } },
      }
      expect(adapter.payloadFrom(orderEntry(transition), { scope: SCOPE })).toEqual({
        payload: {
          id: DOCUMENT_ID,
          orderId: DOCUMENT_ID,
          orderNumber: 'SO-1',
          previousStatus: 'confirmed',
          status: 'canceled',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
        },
        valuePaths: LIFECYCLE_VALUE_PATHS,
      })
      expect(adapter.payloadFrom(orderEntry({ ...transition, causeKind: 'undo' }), { scope: SCOPE })).toBeNull()
      expect(adapter.payloadFrom(orderEntry({ ...transition, executionState: 'failed' }), { scope: SCOPE })).toBeNull()
      expect(adapter.payloadFrom(orderEntry({ ...transition, commandId: 'sales.orders.delete' }), { scope: SCOPE })).toBeNull()
      expect(adapter.payloadFrom(orderEntry({ ...transition, snapshotBefore: null }), { scope: SCOPE })).toBeNull()
      expect(adapter.payloadFrom(orderEntry({ ...transition, snapshotAfter: null }), { scope: SCOPE })).toBeNull()
      expect(adapterFor('sales.order.confirmed').payloadFrom(orderEntry(transition), { scope: SCOPE })).toBeNull()
    })

    it('reports the order number as unknown when the snapshot does not carry it', () => {
      const entry = orderEntry({
        commandId: 'sales.orders.create',
        snapshotAfter: { order: { id: DOCUMENT_ID, status: 'confirmed' } },
      })
      expect(adapterFor('sales.order.confirmed').payloadFrom(entry, { scope: SCOPE })).toEqual({
        payload: {
          id: DOCUMENT_ID,
          orderId: DOCUMENT_ID,
          previousStatus: null,
          status: 'confirmed',
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
        },
        unknownPaths: ['orderNumber'],
        valuePaths: ['previousStatus', 'status'],
      })
    })
  })

  describe('acting user', () => {
    const adapter = adapterFor('sales.order.created')

    it('takes userId from a user actor of an attributed cause', () => {
      for (const causeKind of ['user', 'workflow', 'business_rule', 'ai_tool', 'redo', 'subscriber'] as const) {
        expect(adapter.payloadFrom(orderEntry({ causeKind }), { scope: SCOPE })).toEqual({
          payload: { id: DOCUMENT_ID, organizationId: ORG_ID, tenantId: TENANT_ID, userId: ACTOR_ID },
          valuePaths: ['userId'],
        })
      }
    })

    it('leaves userId unknown for API keys, system actors, agent runs and entries without a cause', () => {
      const unknownUser = {
        payload: { id: DOCUMENT_ID, organizationId: ORG_ID, tenantId: TENANT_ID },
        unknownPaths: ['userId'],
      }
      expect(adapter.payloadFrom(orderEntry({ actorKind: 'api_key' }), { scope: SCOPE })).toEqual(unknownUser)
      expect(adapter.payloadFrom(orderEntry({ actorKind: 'system', actorUserId: null }), { scope: SCOPE })).toEqual(unknownUser)
      expect(adapter.payloadFrom(orderEntry({ causeKind: 'agent' }), { scope: SCOPE })).toEqual(unknownUser)
      expect(adapter.payloadFrom(orderEntry({ causeKind: null }), { scope: SCOPE })).toEqual(unknownUser)
      expect(adapter.payloadFrom(orderEntry({ actorUserId: null }), { scope: SCOPE })).toEqual(unknownUser)
    })
  })

  describe('entry handling', () => {
    it('claims nothing for undo traces, which emit no event', () => {
      const trace = orderEntry({
        causeKind: 'undo',
        snapshotBefore: { order: { id: DOCUMENT_ID } },
        snapshotAfter: null,
      })
      expect(claimedEvents(trace)).toEqual([])
      expect(claimedEvents({ ...trace, causeKind: null })).toEqual([])
    })

    it('claims a create without a recorded cause when its snapshots have the create shape', () => {
      expect(claimedEvents(orderEntry({ causeKind: null })).map((claim) => claim.eventId)).toEqual(['sales.order.created'])
    })

    it('claims nothing for failed entries, other commands or a missing resource id', () => {
      expect(claimedEvents(orderEntry({ executionState: 'failed' }))).toEqual([])
      expect(adapterFor('sales.order.created').payloadFrom(orderEntry({ executionState: 'failed' }), { scope: SCOPE })).toBeNull()
      expect(adapterFor('sales.order.created').payloadFrom(orderEntry({ commandId: 'sales.quotes.convert_to_order' }), { scope: SCOPE })).toBeNull()
      expect(adapterFor('sales.quote.created').payloadFrom(orderEntry(), { scope: SCOPE })).toBeNull()
      expect(claimedEvents(orderEntry({ commandId: 'sales.orders.update', actionType: 'edit' }))).toEqual([])
      expect(claimedEvents(orderEntry({ resourceId: null }))).toEqual([])
    })

    it('takes the organization from the entry and the tenant from the run scope', () => {
      const [claim] = claimedEvents(orderEntry({ organizationId: OTHER_ORG_ID }))
      expect(claim.result.payload).toMatchObject({ organizationId: OTHER_ORG_ID, tenantId: TENANT_ID })
      const [fallback] = claimedEvents(orderEntry({ organizationId: null }))
      expect(fallback.result.payload).toMatchObject({ organizationId: ORG_ID, tenantId: TENANT_ID })
    })
  })
})
