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

import { asValue, createContainer, InjectionMode } from 'awilix'
import {
  CommandBus,
  registerCommand,
  unregisterCommand,
  type CommandLogMetadata,
} from '@open-mercato/shared/lib/commands'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import type {
  ProcessDescriptor,
  ProcessFieldDescriptor,
  ProcessMilestoneDescriptor,
} from '@open-mercato/shared/modules/insights/process'
import {
  buildProcessRegistrySnapshot,
  type RegisteredProcess,
} from '@open-mercato/core/modules/insights/lib/process/registry'
import {
  deriveLogActivities,
  type DerivedActivity,
  type LogDerivation,
  type ProcessSourceEntry,
} from '@open-mercato/core/modules/insights/lib/process/activities'
import processConfig, { SALES_ORDER_PROCESS_KEY, SALES_QUOTE_CONVERT_COMMAND_ID, SALES_QUOTE_PROCESS_KEY } from '../insights.process'
import { defaultEncryptionMaps } from '../encryption'
import { SALES_STATUS_VALUE_REFERENCE_KINDS } from '../lib/explain/statusValueResolvers'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'
const QUOTE_ID = '44444444-4444-4444-8444-444444444444'
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555'
const SHIPMENT_ID = '66666666-6666-4666-8666-666666666666'
const ACTOR_ID = '77777777-7777-4777-8777-777777777777'
const LOG_ID = '88888888-8888-4888-8888-888888888888'
const DRAFT_ENTRY_ID = '99999999-9999-4999-8999-999999999991'
const CONFIRMED_ENTRY_ID = '99999999-9999-4999-8999-999999999992'
const IN_FULFILLMENT_ENTRY_ID = '99999999-9999-4999-8999-999999999993'
const PAYMENT_PENDING_ENTRY_ID = '99999999-9999-4999-8999-999999999994'
const PAYMENT_CAPTURED_ENTRY_ID = '99999999-9999-4999-8999-999999999995'
const FULFILLMENT_PENDING_ENTRY_ID = '99999999-9999-4999-8999-999999999996'
const FULFILLMENT_PICKING_ENTRY_ID = '99999999-9999-4999-8999-999999999997'
const SHIPMENT_PACKED_ENTRY_ID = '99999999-9999-4999-8999-999999999998'
const SHIPMENT_SHIPPED_ENTRY_ID = '99999999-9999-4999-8999-999999999999'
const CURSOR_AT = '2026-10-08T10:00:00.000000Z'
const COMMAND_ID = 'test.insights.process.sales'
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

type OrderRecordSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  orderNumber: string
  statusEntryId: string | null
  status: string | null
  fulfillmentStatusEntryId: string | null
  fulfillmentStatus: string | null
  paymentStatusEntryId: string | null
  paymentStatus: string | null
  customerEntityId: string | null
  customerSnapshot: Record<string, unknown> | null
  currencyCode: string
  comments: string | null
  internalNotes: string | null
  metadata: Record<string, unknown> | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  paidTotalAmount: string
  outstandingAmount: string
}

type OrderGraphSnapshot = {
  order: OrderRecordSnapshot
  lines: Array<Record<string, unknown>>
  adjustments: Array<Record<string, unknown>>
  addresses: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  tags: Array<Record<string, unknown>>
  shipments: Array<Record<string, unknown>>
  payments: Array<Record<string, unknown>>
}

type QuoteRecordSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  quoteNumber: string
  statusEntryId: string | null
  status: string | null
  currencyCode: string
  comments: string | null
  metadata: Record<string, unknown> | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
}

type QuoteGraphSnapshot = {
  quote: QuoteRecordSnapshot
  lines: Array<Record<string, unknown>>
  adjustments: Array<Record<string, unknown>>
  addresses: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  tags: Array<Record<string, unknown>>
}

type PaymentSnapshot = {
  id: string
  orderId: string | null
  organizationId: string
  tenantId: string
  paymentMethodId: string | null
  paymentReference: string | null
  statusEntryId: string | null
  status: string | null
  amount: number
  currencyCode: string
  capturedAmount: number
  refundedAmount: number
  receivedAt: string | null
  capturedAt: string | null
  metadata: Record<string, unknown> | null
  allocations: Array<Record<string, unknown>>
}

type ShipmentSnapshot = {
  id: string
  orderId: string
  organizationId: string
  tenantId: string
  shipmentNumber: string | null
  shippingMethodId: string | null
  statusEntryId: string | null
  status: string | null
  carrierName: string | null
  trackingNumbers: string[] | null
  shippedAt: string | null
  deliveredAt: string | null
  currencyCode: string | null
  notesText: string | null
  metadata: Record<string, unknown> | null
  items: Array<Record<string, unknown>>
}

type CapturedLogPayload = {
  commandId: string
  actionType?: string | null
  actorUserId?: string | null
  organizationId?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  parentResourceKind?: string | null
  parentResourceId?: string | null
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changes?: Record<string, unknown> | null
}

function buildOrderSnapshot(overrides: Partial<OrderRecordSnapshot> = {}): OrderGraphSnapshot {
  return {
    order: {
      id: ORDER_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      orderNumber: 'SO-1001',
      statusEntryId: DRAFT_ENTRY_ID,
      status: 'draft',
      fulfillmentStatusEntryId: FULFILLMENT_PENDING_ENTRY_ID,
      fulfillmentStatus: 'pending',
      paymentStatusEntryId: PAYMENT_PENDING_ENTRY_ID,
      paymentStatus: 'pending',
      customerEntityId: null,
      customerSnapshot: { displayName: 'Ada Lovelace' },
      currencyCode: 'EUR',
      comments: 'Deliver to the back door',
      internalNotes: null,
      metadata: null,
      grandTotalNetAmount: '100.0000',
      grandTotalGrossAmount: '123.0000',
      paidTotalAmount: '0.0000',
      outstandingAmount: '123.0000',
      ...overrides,
    },
    lines: [],
    adjustments: [],
    addresses: [],
    notes: [],
    tags: [],
    shipments: [],
    payments: [],
  }
}

function buildQuoteSnapshot(overrides: Partial<QuoteRecordSnapshot> = {}): QuoteGraphSnapshot {
  return {
    quote: {
      id: QUOTE_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      quoteNumber: 'SQ-2001',
      statusEntryId: DRAFT_ENTRY_ID,
      status: 'draft',
      currencyCode: 'EUR',
      comments: null,
      metadata: null,
      grandTotalNetAmount: '100.0000',
      grandTotalGrossAmount: '123.0000',
      ...overrides,
    },
    lines: [],
    adjustments: [],
    addresses: [],
    notes: [],
    tags: [],
  }
}

function buildPaymentSnapshot(overrides: Partial<PaymentSnapshot> = {}): PaymentSnapshot {
  return {
    id: PAYMENT_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    paymentMethodId: null,
    paymentReference: 'PAY-1',
    statusEntryId: PAYMENT_PENDING_ENTRY_ID,
    status: 'pending',
    amount: 123,
    currencyCode: 'EUR',
    capturedAmount: 0,
    refundedAmount: 0,
    receivedAt: null,
    capturedAt: null,
    metadata: null,
    allocations: [],
    ...overrides,
  }
}

function buildShipmentSnapshot(overrides: Partial<ShipmentSnapshot> = {}): ShipmentSnapshot {
  return {
    id: SHIPMENT_ID,
    orderId: ORDER_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    shipmentNumber: 'SH-1',
    shippingMethodId: null,
    statusEntryId: SHIPMENT_PACKED_ENTRY_ID,
    status: 'packed',
    carrierName: 'DHL',
    trackingNumbers: null,
    shippedAt: null,
    deliveredAt: null,
    currencyCode: 'EUR',
    notesText: null,
    metadata: null,
    items: [],
    ...overrides,
  }
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8'))
}

function getDeclaredProcess(processKey: string): ProcessDescriptor {
  const process = processConfig.processes?.find((entry) => entry.processKey === processKey)
  if (!process) throw new Error(`[internal] missing process ${processKey}`)
  return process
}

function getDeclaredMilestone(key: string): ProcessMilestoneDescriptor {
  const milestone = getDeclaredProcess(SALES_ORDER_PROCESS_KEY).milestones?.find((entry) => entry.key === key)
  if (!milestone) throw new Error(`[internal] missing milestone ${key}`)
  return milestone
}

function buildRegistry(config: unknown = processConfig) {
  return buildProcessRegistrySnapshot(
    [{ moduleId: 'sales', config }],
    [{ moduleId: 'sales', maps: defaultEncryptionMaps }],
  )
}

function registeredProcesses(): RegisteredProcess[] {
  return buildRegistry().processes
}

async function recordThroughCommandBus(log: CommandLogMetadata): Promise<CapturedLogPayload> {
  const logMock = jest.fn(async (payload: CapturedLogPayload) => payload)
  registerCommand({
    id: COMMAND_ID,
    execute: jest.fn(async () => ({ id: log.resourceId ?? null })),
    buildLog: jest.fn(async () => log),
  })
  try {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log: logMock }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
    })
    await new CommandBus().execute(COMMAND_ID, {
      input: {},
      ctx: {
        container,
        auth: { sub: ACTOR_ID, tenantId: TENANT_ID, orgId: ORG_ID },
        organizationScope: null,
        selectedOrganizationId: ORG_ID,
        organizationIds: null,
      },
    })
  } finally {
    unregisterCommand(COMMAND_ID)
  }
  expect(logMock).toHaveBeenCalledTimes(1)
  return logMock.mock.calls[0][0]
}

function toSourceEntry(payload: CapturedLogPayload, overrides: Partial<ProcessSourceEntry> = {}): ProcessSourceEntry {
  return {
    logId: LOG_ID,
    cursorAt: CURSOR_AT,
    commandId: payload.commandId,
    actionType: payload.actionType ?? null,
    executionState: 'done',
    actorUserId: payload.actorUserId ?? null,
    actorKind: 'user',
    resourceKind: payload.resourceKind ?? null,
    resourceId: payload.resourceId ?? null,
    parentResourceKind: payload.parentResourceKind ?? null,
    parentResourceId: payload.parentResourceId ?? null,
    snapshotBefore: payload.snapshotBefore ?? null,
    snapshotAfter: payload.snapshotAfter ?? null,
    changes: payload.changes ?? null,
    causeKind: 'user',
    causeId: null,
    organizationId: payload.organizationId ?? null,
    causation: null,
    historyAction: null,
    sourceLogId: null,
    ...overrides,
  }
}

function expectEvents(derivation: LogDerivation): DerivedActivity[] {
  if (derivation.kind !== 'events') throw new Error(`[internal] expected events, got ${derivation.kind}`)
  return derivation.activities
}

function activityKeys(derivation: LogDerivation): string[] {
  return expectEvents(derivation).map((activity) => activity.activityKey)
}

function orderUpdateLog(before: OrderGraphSnapshot, after: OrderGraphSnapshot, changeKeys: string[]): CommandLogMetadata {
  const changes = buildChanges(asRecord(before.order), asRecord(after.order), changeKeys)
  return {
    resourceKind: 'sales.order',
    resourceId: ORDER_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: Object.keys(changes).length ? changes : null,
  }
}

function paymentLog(snapshots: { before?: PaymentSnapshot; after?: PaymentSnapshot }): CommandLogMetadata {
  const reference = snapshots.after ?? snapshots.before
  return {
    resourceKind: 'sales.payment',
    resourceId: PAYMENT_ID,
    parentResourceKind: 'sales.order',
    parentResourceId: reference?.orderId ?? null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...(snapshots.before ? { snapshotBefore: snapshots.before } : {}),
    ...(snapshots.after ? { snapshotAfter: snapshots.after } : {}),
  }
}

function shipmentLog(snapshots: { before?: ShipmentSnapshot; after?: ShipmentSnapshot }): CommandLogMetadata {
  const reference = snapshots.after ?? snapshots.before
  return {
    resourceKind: 'sales.shipment',
    resourceId: SHIPMENT_ID,
    parentResourceKind: 'sales.order',
    parentResourceId: reference?.orderId ?? null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    ...(snapshots.before ? { snapshotBefore: snapshots.before } : {}),
    ...(snapshots.after ? { snapshotAfter: snapshots.after } : {}),
  }
}

const STATUS_CHANGE_KEYS = ['statusEntryId', 'status']
const PAYMENT_STATUS_CHANGE_KEYS = ['paymentStatusEntryId', 'paymentStatus']
const FULFILLMENT_STATUS_CHANGE_KEYS = ['fulfillmentStatusEntryId', 'fulfillmentStatus']

describe('sales insights.process', () => {
  describe('config shape', () => {
    it('declares version 1 with the order and quote processes', () => {
      expect(processConfig.version).toBe(1)
      expect(processConfig.processes?.map((process) => process.processKey)).toEqual(['sales.order', 'sales.quote'])
      expect(processConfig.actorDimensions).toBeUndefined()
      expect(getDeclaredProcess(SALES_ORDER_PROCESS_KEY)).toMatchObject({
        labelKey: 'sales.insights.process.order',
        resourceKind: 'sales.order',
        logResourceKinds: ['sales.order'],
        entityId: 'sales:sales_order',
        requiredFeatures: ['sales.orders.view'],
        endStates: [{ field: 'status', values: ['fulfilled', 'canceled', 'rejected'] }],
      })
      const quote = getDeclaredProcess(SALES_QUOTE_PROCESS_KEY)
      expect(quote).toMatchObject({
        labelKey: 'sales.insights.process.quote',
        resourceKind: 'sales.quote',
        logResourceKinds: ['sales.quote'],
        entityId: 'sales:sales_quote',
        requiredFeatures: ['sales.quotes.view'],
        endStates: [{ field: 'status', values: ['canceled', 'rejected'] }],
      })
      expect(quote.milestones).toBeUndefined()
      expect(quote.followupFields).toBeUndefined()
    })

    it('maps document status fields to the snapshot root and both flat and deep change keys', () => {
      const describeField = (field: ProcessFieldDescriptor) => [field.key, field.valueKind, field.snapshotPaths, field.changeKeys]
      expect(getDeclaredProcess(SALES_ORDER_PROCESS_KEY).stageFields.map(describeField)).toEqual([
        ['status', 'dictionary', ['order.status'], ['status', 'order.status']],
        ['fulfillmentStatus', 'dictionary', ['order.fulfillmentStatus'], ['fulfillmentStatus', 'order.fulfillmentStatus']],
        ['paymentStatus', 'dictionary', ['order.paymentStatus'], ['paymentStatus', 'order.paymentStatus']],
      ])
      expect(getDeclaredProcess(SALES_QUOTE_PROCESS_KEY).stageFields.map(describeField)).toEqual([
        ['status', 'dictionary', ['quote.status'], ['status', 'quote.status']],
      ])
    })

    it.each([
      ['payment', 'sales.payment', 'sales:sales_payment', SALES_STATUS_VALUE_REFERENCE_KINDS.paymentStatus],
      ['shipment', 'sales.shipment', 'sales:sales_shipment', SALES_STATUS_VALUE_REFERENCE_KINDS.shipmentStatus],
    ])('declares the %s milestone under the order audit rows', (key, resourceKind, entityId, referenceKind) => {
      const milestone = getDeclaredMilestone(key)
      expect(milestone).toEqual({
        key,
        labelKey: `sales.insights.process.milestones.${key}`,
        resourceKind,
        logResourceKinds: [resourceKind],
        parentResourceKinds: ['sales.order'],
        entityId,
        lifecycle: ['created', 'deleted'],
        fields: [
          {
            key: 'status',
            labelKey: `sales.insights.process.milestones.${key}Status`,
            valueKind: 'dictionary',
            snapshotPaths: ['status'],
            changeKeys: ['status'],
            referenceKind,
          },
        ],
      })
    })

    it('declares every referenced label key in all locales', () => {
      const keys = new Set<string>()
      for (const process of processConfig.processes ?? []) {
        keys.add(process.labelKey)
        for (const field of [...process.stageFields, ...(process.followupFields ?? [])]) keys.add(field.labelKey)
        for (const milestone of process.milestones ?? []) {
          keys.add(milestone.labelKey)
          for (const field of milestone.fields ?? []) keys.add(field.labelKey)
        }
      }
      expect(keys.size).toBeGreaterThan(0)
      for (const locale of LOCALES) {
        const dictionary = loadLocale(locale)
        for (const key of keys) {
          expect({ locale, key, present: typeof dictionary[key] === 'string' && dictionary[key].length > 0 }).toEqual({
            locale,
            key,
            present: true,
          })
        }
      }
    })
  })

  describe('registry validation', () => {
    it('accepts both processes against the real sales encryption maps', () => {
      const snapshot = buildRegistry()
      expect(snapshot.rejected).toEqual([])
      expect(snapshot.ready).toBe(true)
      expect(snapshot.processes.map((process) => [process.moduleId, process.processKey])).toEqual([
        ['sales', 'sales.order'],
        ['sales', 'sales.quote'],
      ])
      expect(snapshot.logResourceKinds).toEqual(['sales.order', 'sales.payment', 'sales.quote', 'sales.shipment'])
      const [order] = snapshot.processes
      expect(order.milestones.map((milestone) => [milestone.key, milestone.logResourceKinds, milestone.parentResourceKinds, milestone.entityId])).toEqual([
        ['payment', ['sales.payment'], ['sales.order'], 'sales:sales_payment'],
        ['shipment', ['sales.shipment'], ['sales.order'], 'sales:sales_shipment'],
      ])
    })

    it('rejects a copy whose status field reads the encrypted order comments', () => {
      const declared = getDeclaredProcess(SALES_ORDER_PROCESS_KEY)
      const [statusField, ...otherStageFields] = declared.stageFields
      const tampered: ProcessDescriptor = {
        ...declared,
        stageFields: [{ ...statusField, snapshotPaths: ['order.comments'], changeKeys: ['comments'] }, ...otherStageFields],
      }
      const snapshot = buildRegistry({ version: 1, processes: [tampered] })
      expect(snapshot.processes).toEqual([])
      expect(snapshot.rejected).toEqual([
        { moduleId: 'sales', processKey: 'sales.order', reason: 'field status references the encrypted field comments' },
      ])
    })

    it('rejects a copy whose milestone field reads a module-wide encrypted column', () => {
      const declared = getDeclaredProcess(SALES_ORDER_PROCESS_KEY)
      const metadataStatus: ProcessFieldDescriptor = {
        key: 'status',
        labelKey: 'sales.insights.process.milestones.paymentStatus',
        valueKind: 'dictionary',
        snapshotPaths: ['metadata'],
        changeKeys: ['metadata'],
      }
      const tampered: ProcessDescriptor = {
        ...declared,
        milestones: (declared.milestones ?? []).map((milestone) => (milestone.key === 'payment'
          ? { ...milestone, fields: [metadataStatus] }
          : milestone)),
      }
      const snapshot = buildRegistry({ version: 1, processes: [tampered] })
      expect(snapshot.processes).toEqual([])
      expect(snapshot.rejected).toEqual([
        { moduleId: 'sales', processKey: 'sales.order', reason: 'milestone field payment.status references the encrypted field metadata' },
      ])
    })
  })

  describe('order derivation from command bus audit rows', () => {
    it('projects an order status change recorded with flat change keys', async () => {
      const before = buildOrderSnapshot()
      const after = buildOrderSnapshot({ statusEntryId: CONFIRMED_ENTRY_ID, status: 'confirmed' })
      const payload = await recordThroughCommandBus(orderUpdateLog(before, after, STATUS_CHANGE_KEYS))
      expect(payload.changes).toEqual({
        statusEntryId: { from: DRAFT_ENTRY_ID, to: CONFIRMED_ENTRY_ID },
        status: { from: 'draft', to: 'confirmed' },
      })

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(expectEvents(derivation)).toEqual([
        {
          processKey: 'sales.order',
          caseKind: 'sales.order',
          caseId: ORDER_ID,
          seq: 0,
          activityKind: 'stage',
          activityKey: 'status:confirmed',
          keyPrefix: 'status:',
          keyIncludesValue: true,
          followupField: 'status',
          followupValue: 'confirmed',
          valueKind: 'dictionary',
        },
      ])
      if (derivation.kind !== 'events') throw new Error('[internal] expected events')
      expect(derivation.base).toMatchObject({ sourceLogId: LOG_ID, actorUserId: ACTOR_ID, causeKind: 'user', causeId: null, voided: false })
    })

    it('projects payment and fulfillment status changes in declaration order', async () => {
      const before = buildOrderSnapshot()
      const after = buildOrderSnapshot({
        statusEntryId: IN_FULFILLMENT_ENTRY_ID,
        status: 'in_fulfillment',
        paymentStatusEntryId: PAYMENT_CAPTURED_ENTRY_ID,
        paymentStatus: 'captured',
        fulfillmentStatusEntryId: FULFILLMENT_PICKING_ENTRY_ID,
        fulfillmentStatus: 'picking',
      })
      const payload = await recordThroughCommandBus(
        orderUpdateLog(before, after, [...STATUS_CHANGE_KEYS, ...PAYMENT_STATUS_CHANGE_KEYS, ...FULFILLMENT_STATUS_CHANGE_KEYS]),
      )

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(activityKeys(derivation)).toEqual(['status:in_fulfillment', 'fulfillmentStatus:picking', 'paymentStatus:captured'])
      expect(expectEvents(derivation).map((activity) => [activity.followupField, activity.seq])).toEqual([
        ['status', 0],
        ['fulfillmentStatus', 1],
        ['paymentStatus', 2],
      ])
    })

    it('resolves the status from the flat change keys when the snapshots do not carry it', async () => {
      const before = buildOrderSnapshot()
      const after = buildOrderSnapshot({
        statusEntryId: CONFIRMED_ENTRY_ID,
        status: 'confirmed',
        paymentStatusEntryId: PAYMENT_CAPTURED_ENTRY_ID,
        paymentStatus: 'captured',
      })
      const payload = await recordThroughCommandBus(
        orderUpdateLog(before, after, [...STATUS_CHANGE_KEYS, ...PAYMENT_STATUS_CHANGE_KEYS]),
      )
      expect(Object.keys(payload.changes ?? {}).sort()).toEqual(['paymentStatus', 'paymentStatusEntryId', 'status', 'statusEntryId'])

      const derivation = deriveLogActivities(
        toSourceEntry(payload, { snapshotBefore: { order: { id: ORDER_ID } }, snapshotAfter: { order: { id: ORDER_ID } } }),
        registeredProcesses(),
      )

      expect(activityKeys(derivation)).toEqual(['status:confirmed', 'paymentStatus:captured'])
    })

    it('resolves the status from deep change keys derived by the command bus for other writers', async () => {
      const before = buildOrderSnapshot()
      const after = buildOrderSnapshot({ statusEntryId: CONFIRMED_ENTRY_ID, status: 'canceled' })
      const payload = await recordThroughCommandBus({
        resourceKind: 'sales.order',
        resourceId: ORDER_ID,
        snapshotBefore: before,
        snapshotAfter: after,
      })
      expect(Object.keys(payload.changes ?? {}).sort()).toEqual(['order.status', 'order.statusEntryId'])

      const derivation = deriveLogActivities(
        toSourceEntry(payload, { snapshotBefore: {}, snapshotAfter: {} }),
        registeredProcesses(),
      )

      expect(activityKeys(derivation)).toEqual(['status:canceled'])
      const [order] = registeredProcesses()
      expect(order.endStates[0].values).toContain(expectEvents(derivation)[0].followupValue)
    })

    it('ignores order updates that touch no declared status', async () => {
      const before = buildOrderSnapshot()
      const after = buildOrderSnapshot({ comments: 'Leave at reception', currencyCode: 'USD' })
      const payload = await recordThroughCommandBus(orderUpdateLog(before, after, ['comments', 'currencyCode']))
      expect(deriveLogActivities(toSourceEntry(payload), registeredProcesses())).toEqual({ kind: 'skip', reason: 'no_activity' })
    })
  })

  describe('milestone derivation from command bus audit rows', () => {
    it('projects a payment create onto its order case', async () => {
      const payload = await recordThroughCommandBus(paymentLog({ after: buildPaymentSnapshot() }))
      expect(payload).toMatchObject({ resourceKind: 'sales.payment', parentResourceKind: 'sales.order', parentResourceId: ORDER_ID })

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(expectEvents(derivation)).toEqual([
        {
          processKey: 'sales.order',
          caseKind: 'sales.order',
          caseId: ORDER_ID,
          seq: 0,
          activityKind: 'milestone',
          activityKey: 'payment.created',
          keyPrefix: 'payment.created',
          keyIncludesValue: false,
          followupField: null,
          followupValue: null,
          valueKind: null,
        },
        {
          processKey: 'sales.order',
          caseKind: 'sales.order',
          caseId: ORDER_ID,
          seq: 1,
          activityKind: 'milestone',
          activityKey: 'payment.status:pending',
          keyPrefix: 'payment.status:',
          keyIncludesValue: true,
          followupField: 'payment.status',
          followupValue: 'pending',
          valueKind: 'dictionary',
        },
      ])
    })

    it('projects a payment status update', async () => {
      const payload = await recordThroughCommandBus(
        paymentLog({
          before: buildPaymentSnapshot(),
          after: buildPaymentSnapshot({ statusEntryId: PAYMENT_CAPTURED_ENTRY_ID, status: 'captured', capturedAmount: 123 }),
        }),
      )
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(derivation)).toEqual(['payment.status:captured'])
      expect(expectEvents(derivation)[0]).toMatchObject({ caseId: ORDER_ID, processKey: 'sales.order' })
    })

    it('projects a payment delete as the deleted milestone', async () => {
      const payload = await recordThroughCommandBus(paymentLog({ before: buildPaymentSnapshot({ status: 'captured' }) }))
      expect(payload.snapshotAfter ?? null).toBeNull()

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(expectEvents(derivation)).toEqual([
        expect.objectContaining({ activityKind: 'milestone', activityKey: 'payment.deleted', caseId: ORDER_ID, seq: 0 }),
      ])
    })

    it('skips a payment that is not attached to an order', async () => {
      const payload = await recordThroughCommandBus(paymentLog({ after: buildPaymentSnapshot({ orderId: null }) }))
      expect(payload.parentResourceId).toBeUndefined()
      expect(deriveLogActivities(toSourceEntry(payload), registeredProcesses())).toEqual({ kind: 'skip', reason: 'no_match' })
    })

    it('projects a shipment create onto its order case', async () => {
      const payload = await recordThroughCommandBus(shipmentLog({ after: buildShipmentSnapshot() }))
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(derivation)).toEqual(['shipment.created', 'shipment.status:packed'])
      for (const activity of expectEvents(derivation)) {
        expect(activity).toMatchObject({ processKey: 'sales.order', caseKind: 'sales.order', caseId: ORDER_ID, activityKind: 'milestone' })
      }
    })

    it('projects a shipment status update', async () => {
      const payload = await recordThroughCommandBus(
        shipmentLog({
          before: buildShipmentSnapshot(),
          after: buildShipmentSnapshot({
            statusEntryId: SHIPMENT_SHIPPED_ENTRY_ID,
            status: 'shipped',
            shippedAt: '2026-10-08T09:30:00.000Z',
            trackingNumbers: ['TRACK-1'],
          }),
        }),
      )

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(expectEvents(derivation)).toEqual([
        expect.objectContaining({
          activityKey: 'shipment.status:shipped',
          keyPrefix: 'shipment.status:',
          followupField: 'shipment.status',
          followupValue: 'shipped',
          caseId: ORDER_ID,
          seq: 0,
        }),
      ])
    })

    it('projects a shipment delete as the deleted milestone', async () => {
      const payload = await recordThroughCommandBus(shipmentLog({ before: buildShipmentSnapshot() }))
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(derivation)).toEqual(['shipment.deleted'])
    })
  })

  describe('quote derivation from command bus audit rows', () => {
    it('projects a quote status change recorded with flat change keys', async () => {
      const before = buildQuoteSnapshot()
      const after = buildQuoteSnapshot({ statusEntryId: CONFIRMED_ENTRY_ID, status: 'sent' })
      const changes = buildChanges(asRecord(before.quote), asRecord(after.quote), STATUS_CHANGE_KEYS)
      const payload = await recordThroughCommandBus({
        resourceKind: 'sales.quote',
        resourceId: QUOTE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        snapshotBefore: before,
        snapshotAfter: after,
        changes,
      })
      expect(Object.keys(payload.changes ?? {}).sort()).toEqual(['status', 'statusEntryId'])

      const fromSnapshots = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      const fromChanges = deriveLogActivities(toSourceEntry(payload, { snapshotBefore: {}, snapshotAfter: {} }), registeredProcesses())

      for (const derivation of [fromSnapshots, fromChanges]) {
        expect(expectEvents(derivation)).toEqual([
          expect.objectContaining({
            processKey: 'sales.quote',
            caseKind: 'sales.quote',
            caseId: QUOTE_ID,
            activityKind: 'stage',
            activityKey: 'status:sent',
            seq: 0,
          }),
        ])
      }
    })

    it('starts the order case and ends the quote case on a quote conversion logged on the order', async () => {
      const quote = buildQuoteSnapshot({ statusEntryId: CONFIRMED_ENTRY_ID, status: 'sent' })
      const order = buildOrderSnapshot({ id: QUOTE_ID, statusEntryId: CONFIRMED_ENTRY_ID, status: 'confirmed' })
      const payload = await recordThroughCommandBus({
        resourceKind: 'sales.order',
        resourceId: QUOTE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        snapshotBefore: quote,
        snapshotAfter: order,
      })
      const derivation = deriveLogActivities(
        toSourceEntry(payload, { commandId: SALES_QUOTE_CONVERT_COMMAND_ID }),
        registeredProcesses(),
      )
      expect(expectEvents(derivation).map((activity) => [activity.processKey, activity.caseId, activity.activityKey])).toEqual([
        ['sales.order', QUOTE_ID, 'created'],
        ['sales.order', QUOTE_ID, 'status:confirmed'],
        ['sales.order', QUOTE_ID, 'fulfillmentStatus:pending'],
        ['sales.order', QUOTE_ID, 'paymentStatus:pending'],
        ['sales.quote', QUOTE_ID, 'converted'],
      ])
      const otherCommand = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(otherCommand)).not.toContain('converted')
    })

    it('projects a quote create as created plus its initial status', async () => {
      const payload = await recordThroughCommandBus({
        resourceKind: 'sales.quote',
        resourceId: QUOTE_ID,
        snapshotAfter: buildQuoteSnapshot(),
      })
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(derivation)).toEqual(['created', 'status:draft'])
      for (const activity of expectEvents(derivation)) expect(activity.processKey).toBe('sales.quote')
    })
  })
})
