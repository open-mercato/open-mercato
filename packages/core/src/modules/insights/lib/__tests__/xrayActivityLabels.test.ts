const loggerMock = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() }

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const logger = { ...loggerMock, child: () => logger }
  return { ...actual, createLogger: () => logger }
})

import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { ExplainLoadContext, ExplainReferenceDetail } from '@open-mercato/shared/modules/insights/explain'
import type { ProcessDescriptor, ProcessModuleConfig } from '@open-mercato/shared/modules/insights/process'
import { registerExplainConfigEntries, resetExplainRegistryForTests } from '../explain-registry'
import { testProcessConfig, testRegistry, ORG_ID, OTHER_ORG_ID, STAGE_A, STAGE_B, TENANT_ID, USER_ID } from '../process/__tests__/processTestSupport'
import {
  XRAY_ACTIVITY_LABELS_MAX_KEYS,
  parseXrayActivityKey,
  resolveXrayActivityLabels,
  type XrayActivityLabelContext,
} from '../xrayActivityLabels'
import enDictionary from '../../i18n/en.json'

const STATUS_KIND = 'test.dictionary.status'
const STAGE_KIND = 'test.stage_reference'
const UNKNOWN_STAGE = '55555555-0000-4000-8000-0000000000ff'

const translate = createTranslator({
  ...(enDictionary as Record<string, string>),
  'test.status': 'Status',
  'test.stage': 'Pipeline stage',
  'test.owner': 'Owner',
  'test.payment': 'Payment',
  'test.payment.status': 'Payment status',
  'test.values.won': 'Won',
  'test.exits.converted': 'Converted to order',
})

function labelledConfig(): ProcessModuleConfig {
  const base = testProcessConfig()
  const process = base.processes?.[0] as ProcessDescriptor
  return {
    version: 1,
    processes: [{
      ...process,
      stageFields: [
        { ...process.stageFields[0], referenceKind: STATUS_KIND, valueLabelKeys: { won: 'test.values.won' } },
        { ...process.stageFields[1], referenceKind: STAGE_KIND },
      ],
      exits: [{ key: 'converted', labelKey: 'test.exits.converted', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }],
    }],
  }
}

function labelledProcess() {
  const registry = testRegistry(labelledConfig())
  expect(registry.rejected).toEqual([])
  return registry.processes[0]
}

type Resolver = (ctx: ExplainLoadContext, ids: string[]) => Promise<ExplainReferenceDetail[]>

function registerResolvers(statusResolver: Resolver, stageResolver: Resolver) {
  registerExplainConfigEntries([{
    moduleId: 'test',
    config: {
      version: 1,
      referenceResolvers: [
        { kind: STATUS_KIND, requiredFeatures: ['test.deals.view'], resolve: statusResolver },
        { kind: STAGE_KIND, requiredFeatures: ['test.pipelines.view'], resolve: stageResolver },
      ],
    },
  }])
}

function detail(kind: string, id: string, label: string, organizationId: string | null = ORG_ID): ExplainReferenceDetail {
  return { kind, id, label, href: null, organizationId, facts: {} }
}

function labelContext(overrides: Partial<XrayActivityLabelContext> = {}, granted: string[] = ['test.deals.view', 'test.pipelines.view']) {
  const userHasAllFeatures = jest.fn(async (_userId: string, required: string[]) => required.every((feature) => granted.includes(feature)))
  const em = { fork: jest.fn(() => ({ forked: true })) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'rbacService') return { userHasAllFeatures }
      if (name === 'em') return em
      throw new Error(`[internal] unexpected service ${name}`)
    }),
  }
  const context: XrayActivityLabelContext = {
    container,
    process: labelledProcess(),
    tenantId: TENANT_ID,
    organizationIds: [ORG_ID],
    rbacOrganizationId: ORG_ID,
    userId: USER_ID,
    translate,
    locale: 'en',
    ...overrides,
  }
  return { context, userHasAllFeatures, container }
}

describe('X-Ray activity labels', () => {
  beforeEach(() => {
    resetExplainRegistryForTests()
    loggerMock.warn.mockClear()
    loggerMock.error.mockClear()
  })

  it('parses only keys derived from the declaration', () => {
    const process = labelledProcess()
    expect(parseXrayActivityKey(process, 'status:changed')).toEqual(expect.objectContaining({ kind: 'fieldValue', value: 'changed' }))
    expect(parseXrayActivityKey(process, 'ownerUserId:changed')).toEqual(expect.objectContaining({ kind: 'fieldChanged' }))
    expect(parseXrayActivityKey(process, 'status:a:b.c')).toEqual(expect.objectContaining({ kind: 'fieldValue', value: 'a:b.c' }))
    for (const key of ['ownerUserId:someone', 'priority:high', 'ghost:1', 'status:', 'payment.updated', 'payment.ghost:1', 'other.created', 'converted.created']) {
      expect(parseXrayActivityKey(process, key)).toBeNull()
    }
  })

  it('labels every activity kind with translated declaration labels and reserved values', async () => {
    const { context } = labelContext()
    const labels = await resolveXrayActivityLabels(context, [
      '__start__', '__end__', 'created', 'deleted', 'converted',
      'status:won', 'status:none', 'status:other', 'ownerUserId:changed', 'priority:changed',
      'payment.created', 'payment.deleted', 'payment.status:captured',
      'status:constructor', 'ghost:1',
    ])
    expect(labels).toEqual({
      __start__: 'Start',
      __end__: 'End',
      created: 'Created',
      deleted: 'Deleted',
      converted: 'Converted to order',
      'status:won': 'Status: Won',
      'status:none': 'Status: not set',
      'status:other': 'Status: other value',
      'ownerUserId:changed': 'Owner changed',
      'priority:changed': 'priority changed',
      'payment.created': 'Payment created',
      'payment.deleted': 'Payment deleted',
      'payment.status:captured': 'Payment · Payment status: captured',
      'status:constructor': 'Status: constructor',
    })
  })

  it('resolves dictionary values and record ids once per kind within the caller scope', async () => {
    const statusResolver = jest.fn<Promise<ExplainReferenceDetail[]>, [ExplainLoadContext, string[]]>(async (_ctx, ids) => ids.map((id) => detail(STATUS_KIND, id, `Label of ${id}`)))
    const stageResolver = jest.fn<Promise<ExplainReferenceDetail[]>, [ExplainLoadContext, string[]]>(async () => [
      detail(STAGE_KIND, STAGE_A, 'Qualification'),
      detail(STAGE_KIND, STAGE_B, 'Foreign stage', OTHER_ORG_ID),
    ])
    registerResolvers(statusResolver, stageResolver)
    const { context, userHasAllFeatures } = labelContext()
    const labels = await resolveXrayActivityLabels(context, [
      'status:won', 'status:qa_review', 'status:open', 'status:none',
      `stageId:${STAGE_A}`, `stageId:${STAGE_B}`, `stageId:${UNKNOWN_STAGE}`, 'stageId:none',
    ])
    expect(statusResolver).toHaveBeenCalledTimes(1)
    expect(statusResolver.mock.calls[0][1].sort()).toEqual(['open', 'qa_review'])
    expect(statusResolver.mock.calls[0][0].scope).toEqual({ tenantId: TENANT_ID, organizationIds: [ORG_ID] })
    expect(statusResolver.mock.calls[0][0].em).toEqual({ forked: true })
    expect(stageResolver).toHaveBeenCalledTimes(1)
    expect(stageResolver.mock.calls[0][1].sort()).toEqual([STAGE_A, STAGE_B, UNKNOWN_STAGE].sort())
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['test.deals.view'], { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['test.pipelines.view'], { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(labels).toEqual({
      'status:won': 'Status: Won',
      'status:qa_review': 'Status: Label of qa_review',
      'status:open': 'Status: Label of open',
      'status:none': 'Status: not set',
      [`stageId:${STAGE_A}`]: 'Pipeline stage: Qualification',
      [`stageId:${STAGE_B}`]: 'Pipeline stage: unknown (55555555)',
      [`stageId:${UNKNOWN_STAGE}`]: 'Pipeline stage: unknown (55555555)',
      'stageId:none': 'Pipeline stage: not set',
    })
  })

  it('keeps the fallback when the caller lacks the resolver features', async () => {
    const stageResolver = jest.fn<Promise<ExplainReferenceDetail[]>, [ExplainLoadContext, string[]]>(async () => [detail(STAGE_KIND, STAGE_A, 'Qualification')])
    const statusResolver = jest.fn<Promise<ExplainReferenceDetail[]>, [ExplainLoadContext, string[]]>(async (_ctx, ids) => ids.map((id) => detail(STATUS_KIND, id, 'Open')))
    registerResolvers(statusResolver, stageResolver)
    const { context } = labelContext({}, ['test.deals.view'])
    const labels = await resolveXrayActivityLabels(context, [`stageId:${STAGE_A}`, 'status:open'])
    expect(stageResolver).not.toHaveBeenCalled()
    expect(labels).toEqual({ [`stageId:${STAGE_A}`]: 'Pipeline stage: unknown (55555555)', 'status:open': 'Status: Open' })
  })

  it('never fails the request: a failing resolver or container falls back to declared labels', async () => {
    registerResolvers(async () => { throw new Error('[internal] dictionary down') }, async () => [detail(STAGE_KIND, STAGE_A, 'Qualification')])
    const failingResolver = await resolveXrayActivityLabels(labelContext().context, ['status:open', `stageId:${STAGE_A}`])
    expect(failingResolver).toEqual({ 'status:open': 'Status: open', [`stageId:${STAGE_A}`]: 'Pipeline stage: Qualification' })
    expect(loggerMock.error).toHaveBeenCalled()

    const broken = labelContext({ container: { resolve: () => { throw new Error('[internal] container disposed') } } }).context
    expect(await resolveXrayActivityLabels(broken, ['status:open', 'created'])).toEqual({ 'status:open': 'Status: open', created: 'Created' })
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining('[internal]'), expect.objectContaining({ processKey: 'test.deal' }))
  })

  it('bounds the labels of tenant data and the number of keys', async () => {
    registerResolvers(async (_ctx, ids) => ids.map((id) => detail(STATUS_KIND, id, `{field} ${'x'.repeat(400)}`)), async () => [])
    const labels = await resolveXrayActivityLabels(labelContext().context, ['status:open'])
    expect(labels['status:open'].startsWith('Status: {field} xxx')).toBe(true)
    expect(labels['status:open'].length).toBeLessThanOrEqual(200)
    const many = Array.from({ length: XRAY_ACTIVITY_LABELS_MAX_KEYS + 50 }, (_, index) => `status:value_${index}`)
    const bounded = await resolveXrayActivityLabels(labelContext().context, many)
    expect(Object.keys(bounded)).toHaveLength(XRAY_ACTIVITY_LABELS_MAX_KEYS)
  })
})
