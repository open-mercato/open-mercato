import type { ProcessDescriptor, ProcessModuleConfig } from '@open-mercato/shared/modules/insights/process'
import type { Module } from '@open-mercato/shared/modules/registry'

const loggerMock = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn() }

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const logger = { ...loggerMock, child: () => logger }
  return { ...actual, createLogger: () => logger }
})

import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import {
  buildProcessRegistrySnapshot,
  computeProcessContractHash,
  fieldNameCandidates,
  getProcessRegistry,
  registerProcessConfigEntries,
  resetProcessRegistryForTests,
} from '../registry'
import { testProcessConfig } from './processTestSupport'

function withProcess(overrides: Partial<ProcessDescriptor>): ProcessModuleConfig {
  const base = testProcessConfig()
  const process = base.processes?.[0] as ProcessDescriptor
  return { version: 1, processes: [{ ...process, ...overrides }] }
}

function snapshot(config: ProcessModuleConfig, maps: Module['defaultEncryptionMaps'] = []) {
  return buildProcessRegistrySnapshot([{ moduleId: 'test', config }], [{ moduleId: 'test', maps: maps ?? [] }])
}

describe('process registry validation', () => {
  beforeEach(() => {
    loggerMock.error.mockClear()
  })

  it('accepts a valid declaration and lists every log resource kind', () => {
    const result = snapshot(testProcessConfig())
    expect(result.ready).toBe(true)
    expect(result.rejected).toEqual([])
    expect(result.processes.map((process) => process.processKey)).toEqual(['test.deal'])
    expect(result.logResourceKinds).toEqual(['test.deal', 'test.payment'])
    const [process] = result.processes
    expect(process.logResourceKinds).toEqual(['test.deal'])
    expect(process.milestones[0]).toEqual(expect.objectContaining({ key: 'payment', lifecycle: ['created', 'deleted'], entityId: 'test:payment' }))
  })

  it('rejects a field that references an encrypted column of the declared entity', () => {
    const result = snapshot(testProcessConfig(), [{ entityId: 'test:deal', fields: [{ field: 'priority' }] }])
    expect(result.processes).toEqual([])
    expect(result.rejected).toEqual([
      expect.objectContaining({ moduleId: 'test', processKey: 'test.deal', reason: expect.stringContaining('priority') }),
    ])
  })

  it('rejects a field that matches any encrypted field of the owning module (camelCase path vs snake_case map)', () => {
    const result = snapshot(testProcessConfig(), [{ entityId: 'test:other', fields: [{ field: 'stage_id' }] }])
    expect(result.processes).toEqual([])
    expect(result.rejected[0]?.reason).toContain('stage_id')
  })

  it('rejects a milestone field that references an encrypted milestone column', () => {
    const result = snapshot(testProcessConfig(), [{ entityId: 'test:payment', fields: [{ field: 'status' }] }])
    expect(result.processes).toEqual([])
    expect(result.rejected[0]?.reason).toMatch(/status/)
  })

  it('rejects a path that walks through an encrypted column, not only one ending in it', () => {
    const result = snapshot(
      withProcess({ followupFields: [{ key: 'kind', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['deal.customerSnapshot.kind'] }] }),
      [{ entityId: 'test:deal', fields: [{ field: 'customer_snapshot' }] }],
    )
    expect(result.processes).toEqual([])
    expect(result.rejected[0]?.reason).toContain('customer_snapshot')
    const viaChangeKey = snapshot(
      withProcess({ followupFields: [{ key: 'source', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['deal.source'], changeKeys: ['metadata.source'] }] }),
      [{ entityId: 'test:other', fields: [{ field: 'metadata' }] }],
    )
    expect(viaChangeKey.rejected[0]?.reason).toContain('metadata')
  })

  it('guards a milestone of another module against that module\'s encryption maps', () => {
    const result = buildProcessRegistrySnapshot(
      [{ moduleId: 'test', config: withProcess({
        milestones: [{
          key: 'shipment',
          labelKey: 'x',
          resourceKind: 'other.shipment',
          parentResourceKinds: ['test.deal'],
          entityId: 'other:shipment',
          fields: [{ key: 'carrier', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['carrierCode'] }],
        }],
      }) }],
      [{ moduleId: 'test', maps: [] }, { moduleId: 'other', maps: [{ entityId: 'other:address', fields: [{ field: 'carrier_code' }] }] }],
    )
    expect(result.processes).toEqual([])
    expect(result.rejected[0]?.reason).toContain('carrier_code')
  })

  it('ignores encryption maps of other modules for the module-wide guard', () => {
    const result = buildProcessRegistrySnapshot(
      [{ moduleId: 'test', config: testProcessConfig() }],
      [{ moduleId: 'test', maps: [] }, { moduleId: 'other', maps: [{ entityId: 'other:entity', fields: [{ field: 'priority' }] }] }],
    )
    expect(result.processes).toHaveLength(1)
  })

  it.each<[string, Partial<ProcessDescriptor>]>([
    ['invalid process key', { processKey: 'Deal' }],
    ['missing entity id', { entityId: '' }],
    ['empty required features', { requiredFeatures: [] }],
    ['user ids in a stage field', { stageFields: [{ key: 'ownerUserId', labelKey: 'x', valueKind: 'user', snapshotPaths: ['deal.ownerUserId'] }] }],
    ['unknown value kind', { stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'text' as 'enum', snapshotPaths: ['deal.status'] }] }],
    ['field without snapshot paths', { stageFields: [{ key: 'status', labelKey: 'x', valueKind: 'enum', snapshotPaths: [] }] }],
    ['duplicate field keys', { followupFields: [{ key: 'status', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['deal.status'] }] }],
    ['end state on an undeclared field', { endStates: [{ field: 'missing', values: ['won'] }] }],
    ['end state with a non-identifier value', { endStates: [{ field: 'status', values: ['Won Deal'] }] }],
    ['an entity id that is not <module>:<entity>', { entityId: 'deal' }],
    ['milestone parent outside the case root', {
      milestones: [{ key: 'payment', labelKey: 'x', resourceKind: 'test.payment', parentResourceKinds: ['test.order'], entityId: 'test:payment', lifecycle: ['created'] }],
    }],
    ['milestone holding user ids', {
      milestones: [{
        key: 'payment',
        labelKey: 'x',
        resourceKind: 'test.payment',
        parentResourceKinds: ['test.deal'],
        entityId: 'test:payment',
        fields: [{ key: 'payer', labelKey: 'x', valueKind: 'user', snapshotPaths: ['payerUserId'] }],
      }],
    }],
    ['milestone without an entity id', {
      milestones: [{ key: 'payment', labelKey: 'x', resourceKind: 'test.payment', parentResourceKinds: ['test.deal'], lifecycle: ['created'] } as unknown as NonNullable<ProcessDescriptor['milestones']>[number]],
    }],
    ['milestone entity id that is not <module>:<entity>', {
      milestones: [{ key: 'payment', labelKey: 'x', resourceKind: 'test.payment', parentResourceKinds: ['test.deal'], entityId: 'Payment', lifecycle: ['created'] }],
    }],
    ['no stage field and no milestone', { stageFields: [], milestones: [] }],
    ['an exit named like a lifecycle activity', { exits: [{ key: 'created', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }] }],
    ['an exit without commands', { exits: [{ key: 'converted', labelKey: 'x', commandIds: [], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }] }],
    ['an exit without logged resource kinds', { exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: [], caseIdPaths: ['deal.id'] }] }],
    ['an exit without case id paths', { exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: [] }] }],
    ['an exit colliding with a milestone key', { exits: [{ key: 'payment', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }] }],
  ])('rejects %s', (_label, overrides) => {
    const result = snapshot(withProcess(overrides))
    expect(result.processes).toEqual([])
    expect(result.rejected).toHaveLength(1)
  })

  it('rejects an unsupported config version and keeps the first duplicate process key', () => {
    const result = buildProcessRegistrySnapshot(
      [
        { moduleId: 'first', config: testProcessConfig() },
        { moduleId: 'second', config: testProcessConfig() },
        { moduleId: 'legacy', config: { version: 2, processes: [] } },
        { moduleId: 'empty', config: null },
      ],
      [],
    )
    expect(result.processes.map((process) => process.moduleId)).toEqual(['first'])
    expect(result.rejected.map((rejection) => rejection.moduleId)).toEqual(['second', 'legacy'])
  })

  it('registers the first actor dimension provider per kind and rejects invalid ones', () => {
    const resolveRoles = jest.fn(async () => ({}))
    const result = buildProcessRegistrySnapshot(
      [
        { moduleId: 'auth', config: { version: 1, actorDimensions: [{ kind: 'role', resolve: resolveRoles }] } },
        { moduleId: 'other', config: { version: 1, actorDimensions: [{ kind: 'role', resolve: jest.fn() }, { kind: 'group' as 'team', resolve: jest.fn() }] } },
      ],
      [],
    )
    expect(result.actorDimensions.get('role')).toEqual({ moduleId: 'auth', provider: expect.objectContaining({ kind: 'role' }) })
    expect(result.actorDimensions.has('team')).toBe(false)
    expect(result.rejected).toEqual([expect.objectContaining({ moduleId: 'other', reason: 'invalid actor dimension provider' })])
  })

  it('derives field name candidates in raw and snake_case form', () => {
    const [process] = snapshot(testProcessConfig()).processes
    const stage = process.stageFields.find((field) => field.key === 'stageId')
    expect(stage && fieldNameCandidates(stage)).toEqual(expect.arrayContaining(['stageid', 'stage_id', 'deal']))
    expect(fieldNameCandidates({ key: 'kind', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['order.customerSnapshot.kind'], changeKeys: [] }))
      .toEqual(expect.arrayContaining(['kind', 'order', 'customersnapshot', 'customer_snapshot']))
  })
})

describe('process contract hash', () => {
  it('is stable for the same declarations and ignores labels and features', () => {
    const first = snapshot(testProcessConfig())
    const relabeled = snapshot(withProcess({ labelKey: 'other.label', requiredFeatures: ['other.view'] }))
    expect(first.contractHash).toBe(computeProcessContractHash(first.processes))
    expect(relabeled.contractHash).toBe(first.contractHash)
  })

  it('changes when a derivation-relevant part changes', () => {
    const first = snapshot(testProcessConfig())
    const exited = snapshot(withProcess({ exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }] }))
    expect(exited.rejected).toEqual([])
    expect(exited.processes[0].exits).toEqual([{ key: 'converted', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }])
    expect(exited.contractHash).not.toBe(first.contractHash)
    expect(exited.logResourceKinds).toEqual(['test.deal', 'test.order', 'test.payment'])
    const changed = snapshot(withProcess({ endStates: [{ field: 'status', values: ['won'] }] }))
    const added = snapshot(withProcess({
      stageFields: [
        { key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['deal.status'], changeKeys: ['deal.status', 'status'] },
        { key: 'stageId', labelKey: 'x', valueKind: 'uuid', snapshotPaths: ['deal.stageId'], changeKeys: ['deal.stageId'] },
        { key: 'phase', labelKey: 'x', valueKind: 'enum', snapshotPaths: ['deal.phase'] },
      ],
    }))
    expect(changed.contractHash).not.toBe(first.contractHash)
    expect(added.contractHash).not.toBe(first.contractHash)
  })
})

describe('global process registry', () => {
  beforeEach(() => {
    resetProcessRegistryForTests()
    loggerMock.error.mockClear()
  })

  it('stays not ready (fail closed) until the module registry carries runtime contracts', () => {
    registerModules([{ id: 'test', translations: { en: {} } } as Module])
    registerProcessConfigEntries([{ moduleId: 'test', config: testProcessConfig() }])
    expect(getProcessRegistry()).toEqual(expect.objectContaining({ ready: false, processes: [] }))
  })

  it('validates against the registered encryption maps and re-validates when modules re-register', () => {
    registerModules([{ id: 'test', defaultEncryptionMaps: [] } as Module])
    registerProcessConfigEntries([{ moduleId: 'test', config: testProcessConfig() }])
    expect(getProcessRegistry().processes).toHaveLength(1)

    registerModules([{ id: 'test', defaultEncryptionMaps: [{ entityId: 'test:deal', fields: [{ field: 'status' }] }] } as Module])
    const revalidated = getProcessRegistry()
    expect(revalidated.processes).toEqual([])
    expect(revalidated.rejected).toHaveLength(1)
    expect(loggerMock.error).toHaveBeenCalledWith(
      '[internal] Rejected an insights.process declaration',
      expect.objectContaining({ moduleId: 'test', processKey: 'test.deal' }),
    )
  })
})
