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
import type { ProcessDescriptor, ProcessFieldDescriptor } from '@open-mercato/shared/modules/insights/process'
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
import processConfig, { CUSTOMERS_DEAL_PROCESS_KEY } from '../insights.process'
import { defaultEncryptionMaps } from '../encryption'
import explainConfig, { CUSTOMERS_EXPLAIN_REFERENCE_KINDS } from '../insights.explain'
import { CLOSED_DEAL_STATUS_LIST } from '../lib/dealStatus'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const DEAL_ID = '33333333-3333-4333-8333-333333333333'
const STAGE_A = '44444444-4444-4444-8444-444444444444'
const STAGE_B = '55555555-5555-4555-8555-555555555555'
const ACTOR_ID = '66666666-6666-4666-8666-666666666666'
const OWNER_ID = 'ABCDEF01-2345-4678-8ABC-DEF012345678'
const PREVIOUS_OWNER_ID = '77777777-7777-4777-8777-777777777777'
const LOG_ID = '88888888-8888-4888-8888-888888888888'
const PIPELINE_ID = '99999999-9999-4999-8999-999999999999'
const CURSOR_AT = '2026-10-08T10:00:00.000000Z'
const COMMAND_ID = 'test.insights.process.customers.deal'
const LOCALES = ['en', 'pl', 'de', 'es', 'ko'] as const

type DealRecordSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string
  description: string | null
  status: string
  pipelineStage: string | null
  pipelineId: string | null
  pipelineStageId: string | null
  valueAmount: string | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  ownerUserId: string | null
  source: string | null
  closureOutcome: string | null
  lossReasonId: string | null
  lossNotes: string | null
}

type DealGraphSnapshot = {
  deal: DealRecordSnapshot
  people: string[]
  companies: string[]
  transitions: Array<Record<string, unknown>>
  custom: Record<string, unknown>
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

function buildDealSnapshot(overrides: Partial<DealRecordSnapshot> = {}, custom: Record<string, unknown> = {}): DealGraphSnapshot {
  return {
    deal: {
      id: DEAL_ID,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      title: 'Renewal for Acme',
      description: 'Confidential notes',
      status: 'open',
      pipelineStage: 'Qualification',
      pipelineId: PIPELINE_ID,
      pipelineStageId: STAGE_A,
      valueAmount: '1200.00',
      valueCurrency: 'EUR',
      probability: 20,
      expectedCloseAt: '2026-12-01T00:00:00.000Z',
      ownerUserId: PREVIOUS_OWNER_ID,
      source: 'web',
      closureOutcome: null,
      lossReasonId: null,
      lossNotes: null,
      ...overrides,
    },
    people: [],
    companies: [],
    transitions: [],
    custom,
  }
}

function loadLocale(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'i18n', `${locale}.json`), 'utf8'))
}

function getDeclaredDealProcess(): ProcessDescriptor {
  const process = processConfig.processes?.find((entry) => entry.processKey === CUSTOMERS_DEAL_PROCESS_KEY)
  if (!process) throw new Error('[internal] missing customers.deal process')
  return process
}

function buildRegistry(config: unknown = processConfig) {
  return buildProcessRegistrySnapshot(
    [{ moduleId: 'customers', config }],
    [{ moduleId: 'customers', maps: defaultEncryptionMaps }],
  )
}

function registeredProcesses(): RegisteredProcess[] {
  return buildRegistry().processes
}

async function recordThroughCommandBus(log: CommandLogMetadata): Promise<CapturedLogPayload> {
  const logMock = jest.fn(async (payload: CapturedLogPayload) => payload)
  registerCommand({
    id: COMMAND_ID,
    execute: jest.fn(async () => ({ dealId: DEAL_ID })),
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

function updateLog(before: DealGraphSnapshot, after: DealGraphSnapshot): CommandLogMetadata {
  return {
    resourceKind: 'customers.deal',
    resourceId: DEAL_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    snapshotBefore: before,
    snapshotAfter: after,
  }
}

describe('customers insights.process', () => {
  describe('config shape', () => {
    it('declares version 1 with the deal process only', () => {
      expect(processConfig.version).toBe(1)
      expect(processConfig.processes?.map((process) => process.processKey)).toEqual(['customers.deal'])
      expect(processConfig.actorDimensions).toBeUndefined()
      const deal = getDeclaredDealProcess()
      expect(deal).toMatchObject({
        labelKey: 'customers.insights.process.deal',
        resourceKind: 'customers.deal',
        logResourceKinds: ['customers.deal'],
        entityId: 'customers:customer_deal',
        requiredFeatures: ['customers.deals.view'],
      })
      expect(deal.milestones).toBeUndefined()
    })

    it('maps stage and follow-up fields to the deal command snapshot paths and deep change keys', () => {
      const deal = getDeclaredDealProcess()
      const describeField = (field: ProcessFieldDescriptor) => [field.key, field.valueKind, field.snapshotPaths, field.changeKeys]
      expect(deal.stageFields.map(describeField)).toEqual([
        ['status', 'dictionary', ['deal.status'], ['deal.status']],
        ['pipelineStageId', 'uuid', ['deal.pipelineStageId'], ['deal.pipelineStageId']],
      ])
      expect(deal.followupFields?.map(describeField)).toEqual([
        ['ownerUserId', 'user', ['deal.ownerUserId'], ['deal.ownerUserId']],
      ])
    })

    it('labels status values and pipeline stages through registered explain reference resolvers', () => {
      const deal = getDeclaredDealProcess()
      expect(deal.stageFields.map((field) => [field.key, field.referenceKind])).toEqual([
        ['status', CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus],
        ['pipelineStageId', CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage],
      ])
      const resolverKinds = (explainConfig.referenceResolvers ?? []).map((resolver) => resolver.kind)
      expect(resolverKinds).toEqual(expect.arrayContaining([CUSTOMERS_EXPLAIN_REFERENCE_KINDS.dealStatus, CUSTOMERS_EXPLAIN_REFERENCE_KINDS.pipelineStage]))
      expect(deal.followupFields?.[0]?.referenceKind).toBeUndefined()
    })

    it('ends a deal on every closed status spelling', () => {
      const deal = getDeclaredDealProcess()
      expect(deal.endStates).toEqual([{ field: 'status', values: [...CLOSED_DEAL_STATUS_LIST] }])
      expect(deal.endStates?.[0]?.values).toEqual(['win', 'won', 'lost', 'loose', 'closed'])
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
    it('accepts the deal process against the real customers encryption maps', () => {
      const snapshot = buildRegistry()
      expect(snapshot.rejected).toEqual([])
      expect(snapshot.ready).toBe(true)
      expect(snapshot.processes.map((process) => [process.moduleId, process.processKey])).toEqual([
        ['customers', 'customers.deal'],
      ])
      expect(snapshot.logResourceKinds).toEqual(['customers.deal'])
      const [registered] = snapshot.processes
      expect(registered.stageFields.map((field) => field.key)).toEqual(['status', 'pipelineStageId'])
      expect(registered.followupFields.map((field) => field.key)).toEqual(['ownerUserId'])
      expect(registered.endStates).toEqual([{ field: 'status', values: [...CLOSED_DEAL_STATUS_LIST] }])
      expect(snapshot.actorDimensions.size).toBe(0)
    })

    it('rejects a copy whose stage field reads the encrypted deal title', () => {
      const declared = getDeclaredDealProcess()
      const [statusField, ...otherStageFields] = declared.stageFields
      const tampered: ProcessDescriptor = {
        ...declared,
        stageFields: [
          { ...statusField, snapshotPaths: ['deal.title'], changeKeys: ['deal.title'] },
          ...otherStageFields,
        ],
      }
      const snapshot = buildRegistry({ version: 1, processes: [tampered] })
      expect(snapshot.processes).toEqual([])
      expect(snapshot.rejected).toEqual([
        { moduleId: 'customers', processKey: 'customers.deal', reason: 'field status references the encrypted field title' },
      ])
    })

    it('rejects a copy whose follow-up field reads the encrypted deal description', () => {
      const declared = getDeclaredDealProcess()
      const tampered: ProcessDescriptor = {
        ...declared,
        followupFields: [
          {
            key: 'notes',
            labelKey: 'customers.insights.fields.owner',
            valueKind: 'enum',
            snapshotPaths: ['deal.description'],
          },
        ],
      }
      const snapshot = buildRegistry({ version: 1, processes: [tampered] })
      expect(snapshot.processes).toEqual([])
      expect(snapshot.rejected).toEqual([
        { moduleId: 'customers', processKey: 'customers.deal', reason: 'field notes references the encrypted field description' },
      ])
    })
  })

  describe('derivation from command bus audit rows', () => {
    it('projects a deal create as created plus the initial status and pipeline stage', async () => {
      const payload = await recordThroughCommandBus({
        resourceKind: 'customers.deal',
        resourceId: DEAL_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        snapshotAfter: buildDealSnapshot(),
      })
      expect(payload.snapshotBefore ?? null).toBeNull()
      expect(payload.changes ?? null).toBeNull()

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(activityKeys(derivation)).toEqual(['created', 'status:open', `pipelineStageId:${STAGE_A}`])
      if (derivation.kind !== 'events') throw new Error('[internal] expected events')
      expect(derivation.base).toEqual({
        sourceLogId: LOG_ID,
        occurredAt: CURSOR_AT,
        actorUserId: ACTOR_ID,
        causeKind: 'user',
        causeId: null,
        viaSyncRun: false,
        voided: false,
      })
      expect(derivation.activities.map((activity) => [activity.activityKind, activity.seq])).toEqual([
        ['lifecycle', 0],
        ['stage', 1],
        ['stage', 2],
      ])
      for (const activity of derivation.activities) {
        expect(activity).toMatchObject({ processKey: 'customers.deal', caseKind: 'customers.deal', caseId: DEAL_ID })
      }
      expect(derivation.activities[2]).toMatchObject({
        keyPrefix: 'pipelineStageId:',
        keyIncludesValue: true,
        followupField: 'pipelineStageId',
        followupValue: STAGE_A,
        valueKind: 'uuid',
      })
    })

    it('projects a status and stage change from the snapshots the update command records', async () => {
      const before = buildDealSnapshot()
      const after = buildDealSnapshot({ status: 'win', pipelineStageId: STAGE_B, pipelineStage: 'Closed', closureOutcome: 'won' })
      const payload = await recordThroughCommandBus(updateLog(before, after))

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(activityKeys(derivation)).toEqual(['status:win', `pipelineStageId:${STAGE_B}`])
      const [status, stage] = expectEvents(derivation)
      expect(status).toMatchObject({
        activityKind: 'stage',
        keyPrefix: 'status:',
        keyIncludesValue: true,
        followupField: 'status',
        followupValue: 'win',
        valueKind: 'dictionary',
        seq: 0,
      })
      expect(stage).toMatchObject({ activityKind: 'stage', followupValue: STAGE_B, seq: 1 })
      const [registered] = registeredProcesses()
      expect(registered.endStates[0].values).toContain(status.followupValue)
    })

    it('resolves the same activities from the deep change keys the command bus derives', async () => {
      const before = buildDealSnapshot()
      const after = buildDealSnapshot({ status: 'lost', pipelineStageId: STAGE_B, ownerUserId: OWNER_ID })
      const payload = await recordThroughCommandBus(updateLog(before, after))
      expect(Object.keys(payload.changes ?? {}).sort()).toEqual(['deal.ownerUserId', 'deal.pipelineStageId', 'deal.status'])

      const fromSnapshots = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      const fromChanges = deriveLogActivities(
        toSourceEntry(payload, { snapshotBefore: {}, snapshotAfter: {} }),
        registeredProcesses(),
      )

      expect(activityKeys(fromChanges)).toEqual(['status:lost', `pipelineStageId:${STAGE_B}`, 'ownerUserId:changed'])
      expect(expectEvents(fromChanges)).toEqual(expectEvents(fromSnapshots))
    })

    it('projects an owner hand-over as a follow-up holding the new owner id', async () => {
      const before = buildDealSnapshot({ ownerUserId: null })
      const after = buildDealSnapshot({ ownerUserId: OWNER_ID })
      const payload = await recordThroughCommandBus(updateLog(before, after))

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(activityKeys(derivation)).toEqual(['ownerUserId:changed'])
      expect(expectEvents(derivation)[0]).toEqual({
        processKey: 'customers.deal',
        caseKind: 'customers.deal',
        caseId: DEAL_ID,
        seq: 0,
        activityKind: 'followup',
        activityKey: 'ownerUserId:changed',
        keyPrefix: 'ownerUserId:changed',
        keyIncludesValue: false,
        followupField: 'ownerUserId',
        followupValue: OWNER_ID.toLowerCase(),
        valueKind: 'user',
      })
    })

    it('records an owner removal as a follow-up with no owner', async () => {
      const payload = await recordThroughCommandBus(
        updateLog(buildDealSnapshot({ ownerUserId: PREVIOUS_OWNER_ID }), buildDealSnapshot({ ownerUserId: null })),
      )
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(expectEvents(derivation)).toEqual([
        expect.objectContaining({ activityKey: 'ownerUserId:changed', followupValue: 'none', valueKind: 'user' }),
      ])
    })

    it('stores a free-text status that is not an identifier as other', async () => {
      const payload = await recordThroughCommandBus(
        updateLog(buildDealSnapshot(), buildDealSnapshot({ status: 'Closed Won!' })),
      )
      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())
      expect(activityKeys(derivation)).toEqual(['status:other'])
    })

    it('ignores updates that touch no declared field', async () => {
      const payload = await recordThroughCommandBus(
        updateLog(
          buildDealSnapshot(),
          buildDealSnapshot({ title: 'Renewal for Acme Corp', valueAmount: '1500.00' }, { priority: 'high' }),
        ),
      )
      expect(Object.keys(payload.changes ?? {}).sort()).toEqual(['cf_priority', 'deal.title', 'deal.valueAmount'])
      expect(deriveLogActivities(toSourceEntry(payload), registeredProcesses())).toEqual({ kind: 'skip', reason: 'no_activity' })
    })

    it('projects a deal delete as the deleted lifecycle step', async () => {
      const payload = await recordThroughCommandBus({
        resourceKind: 'customers.deal',
        resourceId: DEAL_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        snapshotBefore: buildDealSnapshot({ status: 'win' }),
      })
      expect(payload.snapshotAfter ?? null).toBeNull()

      const derivation = deriveLogActivities(toSourceEntry(payload), registeredProcesses())

      expect(expectEvents(derivation)).toEqual([
        expect.objectContaining({ activityKind: 'lifecycle', activityKey: 'deleted', caseId: DEAL_ID, seq: 0 }),
      ])
    })

    it('does not match audit rows of other customer resources', async () => {
      const payload = await recordThroughCommandBus({
        resourceKind: 'customers.person',
        resourceId: DEAL_ID,
        snapshotBefore: { entity: { id: DEAL_ID, status: 'active' } },
        snapshotAfter: { entity: { id: DEAL_ID, status: 'inactive' } },
      })
      expect(deriveLogActivities(toSourceEntry(payload), registeredProcesses())).toEqual({ kind: 'skip', reason: 'no_match' })
    })
  })
})
