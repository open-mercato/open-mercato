import { z } from 'zod'
import { createCrudEventAdapters, defineSimulateConfig, defineSimulationKind } from '@open-mercato/shared/modules/insights/simulate'
import {
  getSimulationKind,
  listSimulationEventAdapters,
  listSimulationKinds,
  registerSimulateConfigEntries,
  resetSimulationRegistryForTests,
} from '../registry'

function kind(overrides: Record<string, unknown> = {}) {
  return {
    ...defineSimulationKind({
      kind: 'test_module.backtest',
      artifactKind: 'test_module.thing',
      labelKey: 'test_module.simulation.label',
      requiredFeatures: ['test_module.view'],
      inputSchema: z.object({ id: z.string() }),
      version: 1,
      cellKeys: ['fires'],
      readArtifactVersion: async () => null,
      fingerprintProposal: () => 'fp',
      run: async () => ({ status: 'done' as const, result: { groups: [], coverage: {}, caveats: [], fidelity: 'none' as const, truncated: false }, recordsProcessed: 0 }),
    }),
    ...overrides,
  }
}

describe('simulation registry', () => {
  beforeEach(() => resetSimulationRegistryForTests())

  it('registers inline kinds with live records, and fails closed on an unknown execution, a blank access-log kind or live records without features', () => {
    const list = async () => ({ items: [], total: 0 })
    registerSimulateConfigEntries([{
      moduleId: 'test_module',
      config: {
        version: 1,
        kinds: [
          kind({ kind: 'test_module.inline', execution: 'inline', accessLogResourceKind: 'insights.simulation.permission_preview', liveRecords: { requiredFeatures: ['test_module.users'], list } }),
          kind({ kind: 'test_module.bad_execution', execution: 'later' }),
          kind({ kind: 'test_module.blank_access_log', accessLogResourceKind: ' ' }),
          kind({ kind: 'test_module.records_without_features', liveRecords: { requiredFeatures: [], list } }),
          kind({ kind: 'test_module.records_without_list', liveRecords: { requiredFeatures: ['test_module.users'] } }),
        ],
      },
    }])
    expect(listSimulationKinds().map((entry) => entry.definition.kind)).toEqual(['test_module.inline'])
    expect(getSimulationKind('test_module.inline')?.definition.execution).toBe('inline')
  })

  it('registers kinds and event adapters of supported configs', () => {
    registerSimulateConfigEntries([
      { moduleId: 'test_module', config: defineSimulateConfig({ version: 1, kinds: [kind()], eventAdapters: createCrudEventAdapters({ eventPrefix: 'test_module.thing', logResourceKinds: ['test_module.thing'], requiredFeatures: ['test_module.view'] }) }) },
    ])
    expect(getSimulationKind('test_module.backtest')?.moduleId).toBe('test_module')
    expect(listSimulationEventAdapters().map((adapter) => adapter.eventId)).toEqual([
      'test_module.thing.created',
      'test_module.thing.updated',
      'test_module.thing.deleted',
    ])
  })

  it('fails closed: skips kinds without required features or with an invalid shape', () => {
    registerSimulateConfigEntries([
      {
        moduleId: 'test_module',
        config: {
          version: 1,
          kinds: [
            kind({ kind: 'test_module.no_features', requiredFeatures: [] }),
            kind({ kind: 'test_module.blank_feature', requiredFeatures: [' '] }),
            kind({ kind: 'test_module.no_schema', inputSchema: {} }),
            kind({ kind: 'test_module.no_run', run: undefined }),
            kind({ kind: 'Bad Kind' }),
            kind({ kind: 'test_module.no_cells', cellKeys: [] }),
            kind({ kind: 'test_module.bad_version', version: 0 }),
            kind({ kind: 'test_module.valid' }),
          ],
        },
      },
    ])
    expect(listSimulationKinds().map((entry) => entry.definition.kind)).toEqual(['test_module.valid'])
  })

  it('ignores unsupported versions and invalid adapters', () => {
    registerSimulateConfigEntries([
      { moduleId: 'old_module', config: { version: 2, kinds: [kind({ kind: 'old_module.backtest' })] } },
      { moduleId: 'null_module', config: null },
      {
        moduleId: 'test_module',
        config: {
          version: 1,
          eventAdapters: [
            { eventId: 'test_module.thing.created', logResourceKinds: [], actionTypes: ['create'], requiredFeatures: ['test_module.view'], payloadFrom: () => null },
            { eventId: 'nodots', logResourceKinds: ['a'], actionTypes: ['create'], requiredFeatures: ['test_module.view'], payloadFrom: () => null },
            { eventId: 'test_module.thing.updated', logResourceKinds: ['test_module.thing'], actionTypes: ['edit'], requiredFeatures: ['test_module.view'] },
            { eventId: 'test_module.thing.deleted', logResourceKinds: ['test_module.thing'], actionTypes: ['delete'], payloadFrom: () => null },
          ],
        },
      },
    ])
    expect(listSimulationKinds()).toEqual([])
    expect(listSimulationEventAdapters()).toEqual([])
  })

  it('keeps the first registration of a duplicate kind or event adapter', () => {
    const first = kind()
    registerSimulateConfigEntries([
      { moduleId: 'test_module', config: { version: 1, kinds: [first], eventAdapters: [{ eventId: 'test_module.thing.created', logResourceKinds: ['x'], actionTypes: ['create'], requiredFeatures: ['test_module.view'], payloadFrom: () => null }] } },
      { moduleId: 'other_module', config: { version: 1, kinds: [kind({ labelKey: 'other.label' })], eventAdapters: [{ eventId: 'test_module.thing.created', logResourceKinds: ['y'], actionTypes: ['create'], requiredFeatures: ['test_module.view'], payloadFrom: () => null }] } },
    ])
    expect(getSimulationKind('test_module.backtest')).toEqual({ moduleId: 'test_module', definition: first })
    expect(listSimulationEventAdapters()).toEqual([expect.objectContaining({ moduleId: 'test_module', logResourceKinds: ['x'] })])
  })

  it('shares one registry through globalThis', () => {
    registerSimulateConfigEntries([{ moduleId: 'test_module', config: { version: 1, kinds: [kind()] } }])
    const state = (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/core/insights/simulation-registry')] as { kinds: Map<string, unknown> }
    expect(state.kinds.has('test_module.backtest')).toBe(true)
  })
})
