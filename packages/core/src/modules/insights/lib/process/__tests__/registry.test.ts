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
  restrictProcessRegistry,
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

  it('carries display-only label hints of fields without changing the hash', () => {
    const first = snapshot(testProcessConfig())
    const hinted = snapshot(withProcess({
      stageFields: [
        { key: 'status', labelKey: 'test.status', valueKind: 'dictionary', snapshotPaths: ['deal.status'], changeKeys: ['deal.status', 'status'], referenceKind: 'test.dictionary.status', valueLabelKeys: { won: 'test.values.won' } },
        { key: 'stageId', labelKey: 'test.stage', valueKind: 'uuid', snapshotPaths: ['deal.stageId'], changeKeys: ['deal.stageId'], referenceKind: 'test.stage' },
      ],
    }))
    expect(hinted.rejected).toEqual([])
    expect(hinted.processes[0].stageFields[0]).toEqual(expect.objectContaining({ referenceKind: 'test.dictionary.status', valueLabelKeys: { won: 'test.values.won' } }))
    expect(hinted.processes[0].stageFields[1].referenceKind).toBe('test.stage')
    expect(first.processes[0].stageFields[0]).not.toHaveProperty('referenceKind')
    expect(first.processes[0].stageFields[0]).not.toHaveProperty('valueLabelKeys')
    expect(hinted.contractHash).toBe(first.contractHash)
  })

  it('rejects malformed label hints', () => {
    const field = { key: 'status', labelKey: 'test.status', valueKind: 'dictionary' as const, snapshotPaths: ['deal.status'] }
    for (const hint of [{ referenceKind: '' }, { referenceKind: 'has space' }, { valueLabelKeys: { 'Not Valid': 'x' } }, { valueLabelKeys: { won: '' } }, { valueLabelKeys: ['won'] }]) {
      const result = snapshot(withProcess({ stageFields: [{ ...field, ...hint } as never] }))
      expect(result.processes).toEqual([])
      expect(result.rejected).toEqual([expect.objectContaining({ reason: 'stageFields contains an invalid field' })])
    }
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

  it('keeps one hash per process, so changing one process leaves the others untouched', () => {
    const base = testProcessConfig()
    const deal = base.processes?.[0] as ProcessDescriptor
    const quote: ProcessDescriptor = { ...deal, processKey: 'test.quote', resourceKind: 'test.quote', logResourceKinds: ['test.quote'], entityId: 'test:quote', milestones: [] }
    const first = snapshot({ version: 1, processes: [deal, quote] })
    const changed = snapshot({ version: 1, processes: [deal, { ...quote, endStates: [{ field: 'status', values: ['won'] }] }] })
    expect(Array.from(first.processContractHashes.keys())).toEqual(['test.deal', 'test.quote'])
    expect(changed.processContractHashes.get('test.deal')).toBe(first.processContractHashes.get('test.deal'))
    expect(changed.processContractHashes.get('test.quote')).not.toBe(first.processContractHashes.get('test.quote'))
    const alone = snapshot({ version: 1, processes: [deal] })
    expect(alone.processContractHashes.get('test.deal')).toBe(first.processContractHashes.get('test.deal'))
  })

  it('orders resource kinds and processes by code units, independent of the locale', () => {
    const result = snapshot(withProcess({ logResourceKinds: ['test.deal', 'test.deal_a', 'test.deal-a', 'test.deal0'] }))
    expect(result.logResourceKinds).toEqual(['test.deal', 'test.deal-a', 'test.deal0', 'test.deal_a', 'test.payment'])
    const deal = testProcessConfig().processes?.[0] as ProcessDescriptor
    const underscored = { ...deal, processKey: 'test.a_', milestones: [] }
    const numbered = { ...deal, processKey: 'test.a0', milestones: [] }
    const ordered = snapshot({ version: 1, processes: [underscored, numbered] })
    expect(ordered.processes.map((process) => process.processKey)).toEqual(['test.a0', 'test.a_'])
    expect(Array.from(ordered.processContractHashes.keys())).toEqual(['test.a0', 'test.a_'])
  })

  it('restricts a snapshot to selected processes and their log resource kinds', () => {
    const exited = snapshot(withProcess({ exits: [{ key: 'converted', labelKey: 'x', commandIds: ['test.convert'], logResourceKinds: ['test.order'], caseIdPaths: ['deal.id'] }] }))
    const restricted = restrictProcessRegistry(exited, ['test.deal', 'test.missing'])
    expect(restricted.processes.map((process) => process.processKey)).toEqual(['test.deal'])
    expect(restricted.logResourceKinds).toEqual(['test.deal', 'test.order', 'test.payment'])
    const none = restrictProcessRegistry(exited, ['test.missing'])
    expect(none).toEqual(expect.objectContaining({ processes: [], logResourceKinds: [] }))
    expect(Array.from(none.processContractHashes.keys())).toEqual([])
  })
})

describe('process registry encryption guard by resource kind', () => {
  it('rejects a declaration whose entity id belongs to another module than its resource kind', () => {
    const root = snapshot(withProcess({ resourceKind: 'other.deal', logResourceKinds: ['test.deal'] }))
    expect(root.processes).toEqual([])
    expect(root.rejected[0]?.reason).toContain('resourceKind')
    const milestone = snapshot(withProcess({
      milestones: [{ key: 'payment', labelKey: 'x', resourceKind: 'test.payment', parentResourceKinds: ['test.deal'], entityId: 'other:payment', lifecycle: ['created'] }],
    }))
    expect(milestone.processes).toEqual([])
    expect(milestone.rejected[0]?.reason).toContain('resourceKind')
  })

  it('checks the encryption maps of every module whose audit rows a process reads', () => {
    const viaLogKind = buildProcessRegistrySnapshot(
      [{ moduleId: 'test', config: withProcess({ logResourceKinds: ['test.deal', 'crm.deal'] }) }],
      [{ moduleId: 'test', maps: [] }, { moduleId: 'crm', maps: [{ entityId: 'crm:deal_mirror', fields: [{ field: 'priority' }] }] }],
    )
    expect(viaLogKind.processes).toEqual([])
    expect(viaLogKind.rejected[0]?.reason).toContain('priority')
    const viaMilestoneLogKind = buildProcessRegistrySnapshot(
      [{ moduleId: 'test', config: withProcess({
        milestones: [{
          key: 'payment',
          labelKey: 'x',
          resourceKind: 'test.payment',
          logResourceKinds: ['billing.payment'],
          parentResourceKinds: ['test.deal'],
          entityId: 'test:payment',
          fields: [{ key: 'status', labelKey: 'x', valueKind: 'dictionary', snapshotPaths: ['status'] }],
        }],
      }) }],
      [{ moduleId: 'test', maps: [] }, { moduleId: 'billing', maps: [{ entityId: 'billing:payment', fields: [{ field: 'status' }] }] }],
    )
    expect(viaMilestoneLogKind.processes).toEqual([])
    expect(viaMilestoneLogKind.rejected[0]?.reason).toContain('payment.status')
    const declaredByHost = buildProcessRegistrySnapshot(
      [{ moduleId: 'host', config: testProcessConfig() }],
      [{ moduleId: 'host', maps: [] }, { moduleId: 'test', maps: [{ entityId: 'test:audit_only', fields: [{ field: 'stage_id' }] }] }],
    )
    expect(declaredByHost.processes).toEqual([])
    expect(declaredByHost.rejected[0]?.reason).toContain('stage_id')
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
