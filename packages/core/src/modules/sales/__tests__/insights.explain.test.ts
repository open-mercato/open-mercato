import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

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
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges } from '@open-mercato/shared/lib/commands/helpers'
import explainConfig, { SALES_LINE_PRICE_PROVIDER_ID } from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const STATUS_ENTRY_ID = '66666666-6666-4666-8666-666666666666'
const NEXT_STATUS_ENTRY_ID = '77777777-7777-4777-8777-777777777777'
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

const em = {} as EntityManager

function buildContext(scope: Partial<ExplainScope> = {}): ExplainLoadContext {
  return {
    em,
    resolve: () => undefined,
    scope: { tenantId: TENANT_ID, organizationIds: null, ...scope },
    userId: null,
    locale: 'en',
  }
}

function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8'))
}

function getResource(kind: string) {
  const resource = explainConfig.resources?.find((entry) => entry.resourceKind === kind)
  if (!resource) throw new Error(`[internal] missing resource ${kind}`)
  return resource
}

type CapturedLog = { changes?: Record<string, unknown> | null }

async function captureCommandBusChangeKeys(buildLogResult: Record<string, unknown>): Promise<string[]> {
  const commandId = 'test.insights.explain.sales'
  const logMock = jest.fn(async (payload: CapturedLog) => payload)
  registerCommand({
    id: commandId,
    execute: jest.fn(async () => ({ id: DOCUMENT_ID })),
    buildLog: jest.fn(async () => buildLogResult),
  })
  try {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log: logMock }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
    })
    await new CommandBus().execute(commandId, {
      input: {},
      ctx: {
        container,
        auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_A },
        organizationScope: null,
        selectedOrganizationId: ORG_A,
        organizationIds: null,
      },
    })
  } finally {
    unregisterCommand(commandId)
  }
  return Object.keys(logMock.mock.calls[0]?.[0]?.changes ?? {}).sort()
}

function buildOrderSnapshot(overrides: { statusEntryId: string; netTotal: string; grossTotal: string; unitPriceNet: string }) {
  return {
    order: {
      id: DOCUMENT_ID,
      statusEntryId: overrides.statusEntryId,
      status: 'draft',
      currencyCode: 'EUR',
      grandTotalNetAmount: overrides.netTotal,
      grandTotalGrossAmount: overrides.grossTotal,
    },
    lines: [{ id: LINE_ID, quantity: '2', unitPriceNet: overrides.unitPriceNet, unitPriceGross: '12.30' }],
    adjustments: [],
  }
}

describe('sales insights.explain', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
  })

  describe('config shape', () => {
    it('declares version 1 with the order and quote resources', () => {
      expect(explainConfig.version).toBe(1)
      expect(explainConfig.resources?.map((resource) => resource.resourceKind)).toEqual(['sales.order', 'sales.quote'])
      expect(getResource('sales.order').logResourceKinds).toEqual(['sales.order'])
      expect(getResource('sales.quote').logResourceKinds).toEqual(['sales.quote'])
      expect(getResource('sales.order').requiredFeatures).toEqual(['sales.orders.view'])
      expect(getResource('sales.quote').requiredFeatures).toEqual(['sales.quotes.view'])
      expect(getResource('sales.order').recordHref?.(DOCUMENT_ID)).toBe(`/backend/sales/orders/${DOCUMENT_ID}`)
      expect(getResource('sales.quote').recordHref?.(DOCUMENT_ID)).toBe(`/backend/sales/quotes/${DOCUMENT_ID}`)
    })

    it.each([
      ['sales.order', 'order'],
      ['sales.quote', 'quote'],
    ])('maps %s fields to the %s snapshot root', (kind, root) => {
      const resource = getResource(kind)
      const status = resource.fields.find((field) => field.key === 'status')
      expect(status).toMatchObject({
        valueKind: 'dictionary',
        snapshotPaths: [`${root}.statusEntryId`],
        changeKeys: ['statusEntryId', `${root}.statusEntryId`],
        currentPath: 'statusEntryId',
        referenceKind: 'dictionary.entry',
      })
      for (const totalKey of ['grandTotalNetAmount', 'grandTotalGrossAmount']) {
        expect(resource.fields.find((field) => field.key === totalKey)).toMatchObject({
          valueKind: 'money',
          snapshotPaths: [`${root}.${totalKey}`],
          changeKeys: [`${root}.${totalKey}`],
          derived: { dependsOn: ['lines'] },
        })
      }
      for (const field of resource.fields) {
        expect(field.snapshotPaths.length).toBeGreaterThan(0)
        expect(field.changeKeys?.length).toBeGreaterThan(0)
      }
      const [lines] = resource.collections ?? []
      expect(lines).toMatchObject({ key: 'lines', snapshotPath: 'lines', itemIdPath: 'id', currentPath: 'lines' })
      expect(lines.itemResourceKinds).toBeUndefined()
      expect(lines.fields.map((field) => [field.key, field.snapshotPaths, field.changeKeys, field.provider ?? null])).toEqual([
        ['unitPriceNet', ['unitPriceNet'], ['lines'], SALES_LINE_PRICE_PROVIDER_ID],
        ['unitPriceGross', ['unitPriceGross'], ['lines'], SALES_LINE_PRICE_PROVIDER_ID],
        ['quantity', ['quantity'], ['lines'], null],
      ])
    })

    it('declares the writers that change document status without a document history row', () => {
      const orderStatus = getResource('sales.order').fields.find((field) => field.key === 'status')
      const quoteStatus = getResource('sales.quote').fields.find((field) => field.key === 'status')
      expect(orderStatus?.unloggedWriters?.map((writer) => writer.id)).toEqual([
        'sales.shipments.create',
        'sales.shipments.update',
        'sales.payments.create',
        'sales.payments.update',
      ])
      expect(quoteStatus?.unloggedWriters?.map((writer) => writer.id)).toEqual(['sales.quotes.send', 'sales.quotes.accept'])
    })

    it('declares every referenced label key in all locales', () => {
      const keys = new Set<string>()
      for (const resource of explainConfig.resources ?? []) {
        keys.add(resource.labelKey)
        for (const field of resource.fields) {
          keys.add(field.labelKey)
          for (const writer of field.unloggedWriters ?? []) keys.add(writer.labelKey)
        }
        for (const collection of resource.collections ?? []) {
          keys.add(collection.labelKey)
          for (const field of collection.fields) keys.add(field.labelKey)
        }
      }
      for (const locale of LOCALES) {
        const dictionary = loadLocale(locale)
        for (const key of keys) expect({ locale, key, present: typeof dictionary[key] === 'string' }).toEqual({ locale, key, present: true })
      }
    })
  })

  describe('command bus change keys', () => {
    it('keeps the flat keys the document update command passes explicitly', async () => {
      const before = buildOrderSnapshot({ statusEntryId: STATUS_ENTRY_ID, netTotal: '10.0000', grossTotal: '12.3000', unitPriceNet: '5.0000' })
      const after = buildOrderSnapshot({ statusEntryId: NEXT_STATUS_ENTRY_ID, netTotal: '10.0000', grossTotal: '12.3000', unitPriceNet: '5.0000' })
      const changes = buildChanges(before.order, after.order, ['statusEntryId', 'status'])
      const changeKeys = await captureCommandBusChangeKeys({
        resourceKind: 'sales.order',
        resourceId: DOCUMENT_ID,
        snapshotBefore: before,
        snapshotAfter: after,
        changes,
      })
      expect(changeKeys).toEqual(['statusEntryId'])
      const status = getResource('sales.order').fields.find((field) => field.key === 'status')
      expect(status?.changeKeys).toContain('statusEntryId')
    })

    it('infers deep keys for line changes and recalculated totals', async () => {
      const changeKeys = await captureCommandBusChangeKeys({
        resourceKind: 'sales.order',
        resourceId: DOCUMENT_ID,
        snapshotBefore: buildOrderSnapshot({ statusEntryId: STATUS_ENTRY_ID, netTotal: '10.0000', grossTotal: '12.3000', unitPriceNet: '5.0000' }),
        snapshotAfter: buildOrderSnapshot({ statusEntryId: STATUS_ENTRY_ID, netTotal: '14.0000', grossTotal: '17.2200', unitPriceNet: '7.0000' }),
      })
      expect(changeKeys).toEqual(['lines', 'order.grandTotalGrossAmount', 'order.grandTotalNetAmount'])
      const resource = getResource('sales.order')
      for (const key of ['grandTotalNetAmount', 'grandTotalGrossAmount']) {
        const field = resource.fields.find((entry) => entry.key === key)
        expect(field?.changeKeys?.every((changeKey) => changeKeys.includes(changeKey))).toBe(true)
      }
      for (const field of resource.collections?.[0]?.fields ?? []) {
        expect(field.changeKeys).toEqual(['lines'])
      }
    })
  })

  describe('loadCurrent', () => {
    const order = {
      id: DOCUMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      statusEntryId: STATUS_ENTRY_ID,
      status: 'confirmed',
      grandTotalNetAmount: '10.0000',
      grandTotalGrossAmount: '12.3000',
      currencyCode: 'EUR',
      updatedAt: new Date('2026-10-08T09:00:00.000Z'),
    }
    const line = {
      id: LINE_ID,
      lineNumber: 1,
      quantity: '2.000000',
      unitPriceNet: '5.0000',
      unitPriceGross: '6.1500',
      currencyCode: 'EUR',
    }

    it('reads the order and its lines tenant-wide for an unrestricted scope', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce(order)
      findWithDecryptionMock.mockResolvedValueOnce([line])
      const current = await getResource('sales.order').loadCurrent(buildContext(), DOCUMENT_ID)
      const [, , orderWhere, , orderScope] = findOneWithDecryptionMock.mock.calls[0]
      expect(orderWhere).toEqual({ id: DOCUMENT_ID, tenantId: TENANT_ID, deletedAt: null })
      expect(orderScope).toEqual({ tenantId: TENANT_ID, organizationId: null })
      const [, , lineWhere, lineOptions] = findWithDecryptionMock.mock.calls[0]
      expect(lineWhere).toEqual({ order: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORG_A, deletedAt: null })
      expect(lineOptions).toEqual({ orderBy: { lineNumber: 'asc' } })
      expect(current).toEqual({
        id: DOCUMENT_ID,
        organizationId: ORG_A,
        updatedAt: '2026-10-08T09:00:00.000Z',
        statusEntryId: STATUS_ENTRY_ID,
        status: 'confirmed',
        grandTotalNetAmount: '10.0000',
        grandTotalGrossAmount: '12.3000',
        currencyCode: 'EUR',
        lines: [line],
      })
    })

    it('denies an empty organization scope without querying', async () => {
      await expect(getResource('sales.order').loadCurrent(buildContext({ organizationIds: [] }), DOCUMENT_ID)).resolves.toBeNull()
      await expect(getResource('sales.quote').loadCurrent(buildContext({ organizationIds: [] }), DOCUMENT_ID)).resolves.toBeNull()
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('restricts the quote read to the scoped organizations and skips lines when missing', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce(null)
      const current = await getResource('sales.quote').loadCurrent(buildContext({ organizationIds: [ORG_A, ORG_B] }), DOCUMENT_ID)
      expect(current).toBeNull()
      const [, , where] = findOneWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ id: DOCUMENT_ID, tenantId: TENANT_ID, deletedAt: null, organizationId: { $in: [ORG_A, ORG_B] } })
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('loads quote lines through the quote relation', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce({ ...order, status: 'sent' })
      findWithDecryptionMock.mockResolvedValueOnce([line])
      const current = await getResource('sales.quote').loadCurrent(buildContext({ organizationIds: [ORG_A] }), DOCUMENT_ID)
      const [, , lineWhere] = findWithDecryptionMock.mock.calls[0]
      expect(lineWhere).toEqual({ quote: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORG_A, deletedAt: null })
      expect(current).toMatchObject({ status: 'sent', lines: [line] })
    })

    it('rejects non-UUID record ids without querying', async () => {
      await expect(getResource('sales.order').loadCurrent(buildContext(), 'order-1')).resolves.toBeNull()
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })
  })

  describe('listRecordIds', () => {
    const AFTER_ID = '44444444-4444-4444-8444-000000000001'

    it.each(['sales.order', 'sales.quote'])('lists %s ids scoped to the tenant and organizations with an id keyset', async (resourceKind) => {
      findWithDecryptionMock.mockResolvedValueOnce([{ id: DOCUMENT_ID }])
      const listRecordIds = getResource(resourceKind).listRecordIds
      if (!listRecordIds) throw new Error(`[internal] ${resourceKind} does not list record ids`)

      const ids = await listRecordIds(buildContext({ organizationIds: [ORG_A] }), { limit: 25, afterId: AFTER_ID })

      expect(ids).toEqual([DOCUMENT_ID])
      const [, , where, options, scope] = findWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ tenantId: TENANT_ID, deletedAt: null, organizationId: { $in: [ORG_A] }, id: { $gt: AFTER_ID } })
      expect(options).toEqual({ fields: ['id'], orderBy: { id: 'asc' }, limit: 25 })
      expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
    })

    it('refuses denied scopes and malformed cursors without querying', async () => {
      const listRecordIds = getResource('sales.quote').listRecordIds
      if (!listRecordIds) throw new Error('[internal] quotes do not list record ids')

      await expect(listRecordIds(buildContext({ organizationIds: [] }), { limit: 10, afterId: null })).resolves.toEqual([])
      await expect(listRecordIds(buildContext(), { limit: 10, afterId: 'quote-1' })).resolves.toEqual([])
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
    })
  })
})
