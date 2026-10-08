import fs from 'node:fs'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ExplainLoadContext, ExplainScope } from '@open-mercato/shared/modules/insights/explain'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const loadCustomFieldSnapshotMock = jest.fn()
const resolvePersonCustomFieldRoutingMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: (...args: unknown[]) => loadCustomFieldSnapshotMock(...args),
}))

jest.mock('../lib/customFieldRouting', () => {
  const actual = jest.requireActual('../lib/customFieldRouting')
  return {
    ...actual,
    resolvePersonCustomFieldRouting: (...args: unknown[]) => resolvePersonCustomFieldRoutingMock(...args),
  }
})

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
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
import explainConfig, { CUSTOMERS_EXPLAIN_REFERENCE_KINDS } from '../insights.explain'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const RECORD_ID = '44444444-4444-4444-8444-444444444444'
const PROFILE_ID = '55555555-5555-4555-8555-555555555555'
const STAGE_ID = '66666666-6666-4666-8666-666666666666'
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

async function captureCommandBusChangeKeys(before: Record<string, unknown>, after: Record<string, unknown>): Promise<string[]> {
  const commandId = 'test.insights.explain.customers'
  const logMock = jest.fn(async (payload: { changes?: Record<string, unknown> | null }) => payload)
  registerCommand({
    id: commandId,
    execute: jest.fn(async () => ({ id: RECORD_ID })),
    buildLog: jest.fn(async () => ({
      resourceKind: 'customers.deal',
      resourceId: RECORD_ID,
      snapshotBefore: before,
      snapshotAfter: after,
    })),
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
  const payload = logMock.mock.calls[0]?.[0]
  return Object.keys(payload?.changes ?? {}).sort()
}

function getReferenceResolver(kind: string) {
  const resolver = explainConfig.referenceResolvers?.find((entry) => entry.kind === kind)
  if (!resolver) throw new Error(`[internal] missing reference resolver ${kind}`)
  return resolver
}

describe('customers insights.explain', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
    loadCustomFieldSnapshotMock.mockReset()
    resolvePersonCustomFieldRoutingMock.mockReset()
    reportErrorMock.mockReset()
  })

  describe('config shape', () => {
    it('declares version 1 and the MVP resources with their action-log kinds', () => {
      expect(explainConfig.version).toBe(1)
      expect(explainConfig.resources?.map((resource) => resource.resourceKind)).toEqual([
        'customers.deal',
        'customers.person',
        'customers.company',
      ])
      for (const resource of explainConfig.resources ?? []) {
        expect(resource.logResourceKinds).toEqual([resource.resourceKind])
        expect(resource.customFields?.snapshotContainers).toEqual(['custom'])
      }
      expect(getResource('customers.deal').requiredFeatures).toEqual(['customers.deals.view'])
      expect(getResource('customers.person').requiredFeatures).toEqual(['customers.people.view'])
      expect(getResource('customers.company').requiredFeatures).toEqual(['customers.companies.view'])
    })

    it('maps fields to the command snapshot paths and deep-diff change keys', () => {
      expect(getResource('customers.deal').fields.map((field) => [field.key, field.snapshotPaths[0]])).toEqual([
        ['status', 'deal.status'],
        ['pipelineStageId', 'deal.pipelineStageId'],
        ['valueAmount', 'deal.valueAmount'],
        ['valueCurrency', 'deal.valueCurrency'],
        ['ownerUserId', 'deal.ownerUserId'],
      ])
      for (const kind of ['customers.person', 'customers.company']) {
        expect(getResource(kind).fields.map((field) => [field.key, field.snapshotPaths[0]])).toEqual([
          ['displayName', 'entity.displayName'],
          ['status', 'entity.status'],
          ['lifecycleStage', 'entity.lifecycleStage'],
        ])
      }
      for (const resource of explainConfig.resources ?? []) {
        for (const field of resource.fields) {
          expect(field.snapshotPaths.length).toBeGreaterThan(0)
          expect(field.changeKeys).toEqual(field.snapshotPaths)
          expect(field.currentPath).toBe(field.key)
        }
      }
      expect(getResource('customers.deal').fields.find((field) => field.key === 'ownerUserId')?.referenceKind).toBe('auth.user')
    })

    it('matches the change keys the command bus derives from deal snapshots', async () => {
      const changeKeys = await captureCommandBusChangeKeys(
        {
          deal: { id: RECORD_ID, status: 'open', pipelineStageId: STAGE_ID, valueAmount: '10.00', valueCurrency: 'EUR', ownerUserId: null },
          people: [],
          companies: [],
          transitions: [],
          custom: { priority: 'low' },
        },
        {
          deal: { id: RECORD_ID, status: 'win', pipelineStageId: PROFILE_ID, valueAmount: '20.00', valueCurrency: 'USD', ownerUserId: ORG_B },
          people: [],
          companies: [],
          transitions: [],
          custom: { priority: 'high' },
        },
      )
      expect(changeKeys).toEqual([
        'cf_priority',
        'deal.ownerUserId',
        'deal.pipelineStageId',
        'deal.status',
        'deal.valueAmount',
        'deal.valueCurrency',
      ])
      for (const field of getResource('customers.deal').fields) {
        expect(field.changeKeys?.every((key) => changeKeys.includes(key))).toBe(true)
      }
    })

    it('matches the change keys the command bus derives from person snapshots', async () => {
      const changeKeys = await captureCommandBusChangeKeys(
        {
          entity: { id: RECORD_ID, displayName: 'Ada', status: 'active', lifecycleStage: 'lead' },
          profile: { id: PROFILE_ID, firstName: 'Ada' },
          tagIds: [],
        },
        {
          entity: { id: RECORD_ID, displayName: 'Ada L.', status: 'inactive', lifecycleStage: 'customer' },
          profile: { id: PROFILE_ID, firstName: 'Ada' },
          tagIds: [],
        },
      )
      expect(changeKeys).toEqual(['entity.displayName', 'entity.lifecycleStage', 'entity.status'])
      for (const field of getResource('customers.person').fields) {
        expect(field.changeKeys?.every((key) => changeKeys.includes(key))).toBe(true)
      }
    })

    it('declares every referenced label key in all locales', () => {
      const keys = new Set<string>()
      for (const resource of explainConfig.resources ?? []) {
        keys.add(resource.labelKey)
        for (const field of resource.fields) keys.add(field.labelKey)
      }
      for (const locale of LOCALES) {
        const dictionary = loadLocale(locale)
        for (const key of keys) expect({ locale, key, present: typeof dictionary[key] === 'string' }).toEqual({ locale, key, present: true })
      }
    })

    it('builds detail hrefs for each resource', () => {
      expect(getResource('customers.deal').recordHref?.(RECORD_ID)).toBe(`/backend/customers/deals/${RECORD_ID}`)
      expect(getResource('customers.person').recordHref?.(RECORD_ID)).toBe(`/backend/customers/people-v2/${RECORD_ID}`)
      expect(getResource('customers.company').recordHref?.(RECORD_ID)).toBe(`/backend/customers/companies-v2/${RECORD_ID}`)
    })
  })

  describe('loadCurrent', () => {
    const deal = {
      id: RECORD_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_A,
      status: 'open',
      pipelineStageId: STAGE_ID,
      valueAmount: '1200.00',
      valueCurrency: 'EUR',
      ownerUserId: null,
      updatedAt: new Date('2026-10-08T09:00:00.000Z'),
    }

    it('reads tenant-wide for an unrestricted scope and flattens custom fields', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce(deal)
      loadCustomFieldSnapshotMock.mockResolvedValueOnce({ priority: 'high' })
      const current = await getResource('customers.deal').loadCurrent(buildContext(), RECORD_ID)
      expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
      const [, , where, , scope] = findOneWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ id: RECORD_ID, tenantId: TENANT_ID, deletedAt: null })
      expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: null })
      expect(loadCustomFieldSnapshotMock).toHaveBeenCalledWith(em, {
        entityId: 'customers:customer_deal',
        recordId: RECORD_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_A,
      })
      expect(current).toEqual({
        id: RECORD_ID,
        organizationId: ORG_A,
        updatedAt: '2026-10-08T09:00:00.000Z',
        status: 'open',
        pipelineStageId: STAGE_ID,
        valueAmount: '1200.00',
        valueCurrency: 'EUR',
        ownerUserId: null,
        'cf:priority': 'high',
      })
    })

    it('denies an empty organization scope without querying', async () => {
      const current = await getResource('customers.deal').loadCurrent(buildContext({ organizationIds: [] }), RECORD_ID)
      expect(current).toBeNull()
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('restricts the read to the scoped organizations', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce(null)
      const current = await getResource('customers.deal').loadCurrent(
        buildContext({ organizationIds: [ORG_A, ORG_B] }),
        RECORD_ID,
      )
      expect(current).toBeNull()
      const [, , where] = findOneWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ id: RECORD_ID, tenantId: TENANT_ID, deletedAt: null, organizationId: { $in: [ORG_A, ORG_B] } })
      expect(loadCustomFieldSnapshotMock).not.toHaveBeenCalled()
    })

    it('rejects non-UUID record ids without querying', async () => {
      const current = await getResource('customers.deal').loadCurrent(buildContext(), 'not-a-uuid')
      expect(current).toBeNull()
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('loads a person with merged entity and profile custom fields', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce({
        id: RECORD_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_A,
        displayName: 'Ada Lovelace',
        status: 'active',
        lifecycleStage: 'customer',
        updatedAt: new Date('2026-10-08T09:00:00.000Z'),
        personProfile: { id: PROFILE_ID },
      })
      loadCustomFieldSnapshotMock.mockResolvedValueOnce({ shared: 'entity', onlyEntity: 1 })
      loadCustomFieldSnapshotMock.mockResolvedValueOnce({ shared: 'profile', onlyProfile: 2 })
      resolvePersonCustomFieldRoutingMock.mockResolvedValueOnce(new Map([['shared', 'customers:customer_entity']]))
      const current = await getResource('customers.person').loadCurrent(
        buildContext({ organizationIds: [ORG_A] }),
        RECORD_ID,
      )
      const [, , where, options, scope] = findOneWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({
        id: RECORD_ID,
        tenantId: TENANT_ID,
        kind: 'person',
        deletedAt: null,
        organizationId: { $in: [ORG_A] },
      })
      expect(options).toEqual({ populate: ['personProfile'] })
      expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
      expect(loadCustomFieldSnapshotMock.mock.calls.map((call) => call[1].entityId)).toEqual([
        'customers:customer_entity',
        'customers:customer_person_profile',
      ])
      expect(loadCustomFieldSnapshotMock.mock.calls[1][1].recordId).toBe(PROFILE_ID)
      expect(current).toEqual({
        id: RECORD_ID,
        organizationId: ORG_A,
        updatedAt: '2026-10-08T09:00:00.000Z',
        displayName: 'Ada Lovelace',
        status: 'active',
        lifecycleStage: 'customer',
        'cf:shared': 'entity',
        'cf:onlyEntity': 1,
        'cf:onlyProfile': 2,
      })
    })

    it('loads a company with custom fields from its profile record', async () => {
      findOneWithDecryptionMock.mockResolvedValueOnce({
        id: RECORD_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_A,
        displayName: 'Acme',
        status: null,
        lifecycleStage: 'lead',
        updatedAt: new Date('2026-10-08T09:00:00.000Z'),
        companyProfile: { id: PROFILE_ID },
      })
      loadCustomFieldSnapshotMock.mockResolvedValueOnce({ tier: 'gold' })
      const current = await getResource('customers.company').loadCurrent(buildContext(), RECORD_ID)
      const [, , where, options] = findOneWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ id: RECORD_ID, tenantId: TENANT_ID, kind: 'company', deletedAt: null })
      expect(options).toEqual({ populate: ['companyProfile'] })
      expect(loadCustomFieldSnapshotMock).toHaveBeenCalledWith(em, {
        entityId: 'customers:customer_company_profile',
        recordId: PROFILE_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_A,
      })
      expect(current).toMatchObject({ displayName: 'Acme', lifecycleStage: 'lead', 'cf:tier': 'gold' })
    })
  })

  describe('listRecordIds', () => {
    const AFTER_ID = '44444444-4444-4444-8444-000000000001'

    it.each([
      ['customers.deal', {}],
      ['customers.person', { kind: 'person' }],
      ['customers.company', { kind: 'company' }],
    ])('lists %s ids scoped to the tenant and organizations with an id keyset', async (resourceKind, kindWhere) => {
      findWithDecryptionMock.mockResolvedValueOnce([{ id: RECORD_ID }])
      const listRecordIds = getResource(resourceKind).listRecordIds
      if (!listRecordIds) throw new Error(`[internal] ${resourceKind} does not list record ids`)

      const ids = await listRecordIds(buildContext({ organizationIds: [ORG_A] }), { limit: 50, afterId: AFTER_ID })

      expect(ids).toEqual([RECORD_ID])
      const [, , where, options, scope] = findWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({
        tenantId: TENANT_ID,
        deletedAt: null,
        organizationId: { $in: [ORG_A] },
        id: { $gt: AFTER_ID },
        ...kindWhere,
      })
      expect(options).toEqual({ fields: ['id'], orderBy: { id: 'asc' }, limit: 50 })
      expect(scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_A })
    })

    it('reads the first page tenant-wide and refuses denied scopes or malformed cursors without querying', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([])
      const listRecordIds = getResource('customers.deal').listRecordIds
      if (!listRecordIds) throw new Error('[internal] deals do not list record ids')

      await listRecordIds(buildContext(), { limit: 5000, afterId: null })
      const [, , where, options] = findWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ tenantId: TENANT_ID, deletedAt: null })
      expect(options).toEqual(expect.objectContaining({ limit: 1000 }))

      findWithDecryptionMock.mockClear()
      await expect(listRecordIds(buildContext({ organizationIds: [] }), { limit: 10, afterId: null })).resolves.toEqual([])
      await expect(listRecordIds(buildContext(), { limit: 10, afterId: 'not-a-uuid' })).resolves.toEqual([])
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
    })
  })

  describe('reference resolvers', () => {
    it('resolves pipeline stages in one scoped batch', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { id: STAGE_ID, label: 'Negotiation', organizationId: ORG_A, pipelineId: RECORD_ID, order: 3 },
      ])
      const resolver = getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage)
      expect(resolver.requiredFeatures).toEqual(['customers.pipelines.view'])
      const details = await resolver.resolve(buildContext({ organizationIds: [ORG_A] }), [STAGE_ID, STAGE_ID, 'bogus'])
      expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
      const [, , where] = findWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({ id: { $in: [STAGE_ID] }, tenantId: TENANT_ID, organizationId: { $in: [ORG_A] } })
      expect(details).toEqual([
        {
          kind: 'customers.pipeline_stage',
          id: STAGE_ID,
          label: 'Negotiation',
          href: null,
          organizationId: ORG_A,
          facts: { pipelineId: RECORD_ID, order: 3 },
        },
      ])
    })

    it('resolves dictionary values including legacy deal status spellings', async () => {
      findWithDecryptionMock.mockResolvedValueOnce([
        { normalizedValue: 'win', value: 'win', label: 'Won', organizationId: ORG_A },
        { normalizedValue: 'open', value: 'open', label: 'Open', organizationId: ORG_A },
      ])
      const resolver = getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus)
      const details = await resolver.resolve(buildContext(), ['won', 'open', 'unknown'])
      expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
      const [, , where] = findWithDecryptionMock.mock.calls[0]
      expect(where).toEqual({
        tenantId: TENANT_ID,
        kind: 'deal_status',
        normalizedValue: { $in: ['won', 'win', 'open', 'unknown'] },
      })
      expect(details.map((detail) => [detail.id, detail.label])).toEqual([
        ['won', 'Won'],
        ['open', 'Open'],
      ])
    })

    it('gates deal status labels on deal access and entity dictionaries on the dictionary API feature', () => {
      expect(getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus).requiredFeatures).toEqual(['customers.deals.view'])
      expect(getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.entityStatus).requiredFeatures).toEqual(['customers.people.view'])
      expect(getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.lifecycleStage).requiredFeatures).toEqual(['customers.people.view'])
    })

    it('uses the entity status and lifecycle dictionaries for people and companies', async () => {
      findWithDecryptionMock.mockResolvedValue([])
      await getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.entityStatus).resolve(buildContext(), ['Active'])
      await getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.lifecycleStage).resolve(buildContext(), ['lead'])
      expect(findWithDecryptionMock.mock.calls.map((call) => [call[2].kind, call[2].normalizedValue])).toEqual([
        ['status', { $in: ['active'] }],
        ['lifecycle_stage', { $in: ['lead'] }],
      ])
    })

    it('skips the query for a denied scope and returns [] on failures', async () => {
      const resolver = getReferenceResolver(CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage)
      await expect(resolver.resolve(buildContext({ organizationIds: [] }), [STAGE_ID])).resolves.toEqual([])
      expect(findWithDecryptionMock).not.toHaveBeenCalled()
      findWithDecryptionMock.mockRejectedValueOnce(new Error('db down'))
      await expect(resolver.resolve(buildContext(), [STAGE_ID])).resolves.toEqual([])
      expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), {
        module: 'customers',
        code: 'customers.insights_reference_failed',
        attributes: { kind: 'customers.pipeline_stage' },
      })
    })
  })
})
