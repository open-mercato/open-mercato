import type { ExplainModuleConfig } from '@open-mercato/shared/modules/insights/explain'
import {
  findExplainResourceByLogKind,
  getExplainCauseResolver,
  getExplainProvider,
  getExplainReferenceResolver,
  getExplainResource,
  listExplainResources,
  registerExplainConfigEntries,
  resetExplainRegistryForTests,
} from '../explain-registry'

const loadCurrent = async () => null

function config(overrides: Partial<ExplainModuleConfig> = {}): ExplainModuleConfig {
  return {
    version: 1,
    resources: [{
      resourceKind: 'customers.deal',
      logResourceKinds: ['customers.deal', 'customers.deal_legacy'],
      labelKey: 'customers.deal',
      requiredFeatures: ['customers.deals.view'],
      loadCurrent,
      fields: [{ key: 'status', labelKey: 'status', valueKind: 'enum', snapshotPaths: ['deal.status'] }],
    }],
    causeResolvers: [{ kind: 'workflow', requiredFeatures: ['workflows.view'], resolve: async () => [] }],
    referenceResolvers: [{ kind: 'dictionary.entry', requiredFeatures: ['dictionaries.view'], resolve: async () => [] }],
    providers: [{ id: 'customers.status', explain: async () => [] }],
    ...overrides,
  }
}

describe('explain registry', () => {
  beforeEach(() => resetExplainRegistryForTests())

  it('registers resources, resolvers and providers and indexes log resource kinds', () => {
    registerExplainConfigEntries([{ moduleId: 'customers', config: config() }])

    expect(getExplainResource('customers.deal')?.moduleId).toBe('customers')
    expect(findExplainResourceByLogKind('customers.deal_legacy')?.descriptor.resourceKind).toBe('customers.deal')
    expect(getExplainCauseResolver('workflow')?.moduleId).toBe('customers')
    expect(getExplainReferenceResolver('dictionary.entry')).not.toBeNull()
    expect(getExplainProvider('customers.status')).not.toBeNull()
    expect(listExplainResources()).toHaveLength(1)
  })

  it('keeps the first registration when another module declares the same resource kind', () => {
    registerExplainConfigEntries([
      { moduleId: 'customers', config: config() },
      { moduleId: 'intruder', config: config({ causeResolvers: [], referenceResolvers: [], providers: [] }) },
    ])

    expect(getExplainResource('customers.deal')?.moduleId).toBe('customers')
    expect(listExplainResources()).toHaveLength(1)
  })

  it('keeps the first cause resolver, reference resolver and provider per key', () => {
    registerExplainConfigEntries([
      { moduleId: 'workflows', config: config({ resources: [] }) },
      { moduleId: 'other', config: config({ resources: [] }) },
    ])

    expect(getExplainCauseResolver('workflow')?.moduleId).toBe('workflows')
    expect(getExplainReferenceResolver('dictionary.entry')?.moduleId).toBe('workflows')
    expect(getExplainProvider('customers.status')?.moduleId).toBe('workflows')
  })

  it('re-registers the same module idempotently', () => {
    registerExplainConfigEntries([{ moduleId: 'customers', config: config() }])
    registerExplainConfigEntries([{ moduleId: 'customers', config: config() }])

    expect(listExplainResources()).toHaveLength(1)
    expect(getExplainResource('customers.deal')?.moduleId).toBe('customers')
  })

  it('does not let a second resource steal an indexed log resource kind', () => {
    const base = config()
    const second = config({
      resources: [{
        ...base.resources![0],
        resourceKind: 'customers.deal_v2',
        logResourceKinds: ['customers.deal_legacy'],
      }],
    })
    registerExplainConfigEntries([
      { moduleId: 'customers', config: base },
      { moduleId: 'customers_v2', config: second },
    ])

    expect(findExplainResourceByLogKind('customers.deal_legacy')?.descriptor.resourceKind).toBe('customers.deal')
    expect(findExplainResourceByLogKind('customers.deal_v2')?.descriptor.resourceKind).toBe('customers.deal_v2')
  })

  it('ignores configs with an unsupported version or invalid shape', () => {
    registerExplainConfigEntries([
      { moduleId: 'future', config: { ...config(), version: 2 } },
      { moduleId: 'broken', config: 'not-an-object' },
      { moduleId: 'empty', config: null },
      {
        moduleId: 'invalid',
        config: {
          version: 1,
          resources: [{ resourceKind: 'x.y', labelKey: 'x', requiredFeatures: [], fields: [] }],
          causeResolvers: [{ kind: 'not-a-kind', requiredFeatures: [], resolve: async () => [] }],
          providers: [{ id: '' }],
        },
      },
    ])

    expect(listExplainResources()).toEqual([])
    expect(getExplainCauseResolver('workflow')).toBeNull()
  })

  it('rejects resources and resolvers that declare no required features', () => {
    const base = config()
    registerExplainConfigEntries([{
      moduleId: 'open',
      config: {
        version: 1,
        resources: [
          { ...base.resources![0], resourceKind: 'open.empty', logResourceKinds: undefined, requiredFeatures: [] },
          { ...base.resources![0], resourceKind: 'open.blank', logResourceKinds: undefined, requiredFeatures: [''] },
          { ...base.resources![0], resourceKind: 'open.missing', logResourceKinds: undefined, requiredFeatures: undefined },
        ],
        causeResolvers: [{ kind: 'workflow', requiredFeatures: [], resolve: async () => [] }],
        referenceResolvers: [
          { kind: 'dictionary.entry', requiredFeatures: [], resolve: async () => [] },
          { kind: 'auth.user', requiredFeatures: undefined, resolve: async () => [] },
        ],
      },
    }])

    expect(listExplainResources()).toEqual([])
    expect(findExplainResourceByLogKind('open.empty')).toBeNull()
    expect(getExplainCauseResolver('workflow')).toBeNull()
    expect(getExplainReferenceResolver('dictionary.entry')).toBeNull()
    expect(getExplainReferenceResolver('auth.user')).toBeNull()
  })

  it('rejects field, collection and custom-field feature lists holding blank entries', () => {
    const base = config()
    const resource = base.resources![0]
    registerExplainConfigEntries([{
      moduleId: 'blank',
      config: {
        version: 1,
        resources: [
          { ...resource, resourceKind: 'blank.field', logResourceKinds: undefined, fields: [{ ...resource.fields[0], requiredFeatures: [''] }] },
          {
            ...resource,
            resourceKind: 'blank.collection',
            logResourceKinds: undefined,
            collections: [{ key: 'lines', labelKey: 'lines', snapshotPath: 'lines', itemIdPath: 'id', requiredFeatures: [' '], fields: [] }],
          },
          { ...resource, resourceKind: 'blank.custom', logResourceKinds: undefined, customFields: { entityId: 'x:y', requiredFeatures: [''] } },
          { ...resource, resourceKind: 'open.field', logResourceKinds: undefined, fields: [{ ...resource.fields[0], requiredFeatures: [] }] },
        ],
      },
    }])

    expect(listExplainResources().map((entry) => entry.descriptor.resourceKind)).toEqual(['open.field'])
  })

  it('accepts collections that declare their item resource kinds and rejects malformed ones', () => {
    const base = config()
    const resource = base.resources![0]
    registerExplainConfigEntries([{
      moduleId: 'sales',
      config: {
        version: 1,
        resources: [
          {
            ...resource,
            resourceKind: 'sales.order',
            logResourceKinds: undefined,
            collections: [{ key: 'lines', labelKey: 'lines', snapshotPath: 'lines', itemIdPath: 'id', itemResourceKinds: ['sales.order_line'], fields: [] }],
          },
          {
            ...resource,
            resourceKind: 'sales.quote',
            logResourceKinds: undefined,
            collections: [{ key: 'lines', labelKey: 'lines', snapshotPath: 'lines', itemIdPath: 'id', itemResourceKinds: 'sales.quote_line', fields: [] }],
          },
        ],
      },
    }])

    expect(getExplainResource('sales.order')).not.toBeNull()
    expect(getExplainResource('sales.quote')).toBeNull()
  })

  it('stores the registry on globalThis so duplicated module instances share it', () => {
    registerExplainConfigEntries([{ moduleId: 'customers', config: config() }])
    const registryKey = Symbol.for('@open-mercato/core/insights/explain-registry')
    const state = (globalThis as Record<symbol, unknown>)[registryKey] as { resources: Map<string, unknown> }
    expect(state.resources.has('customers.deal')).toBe(true)
  })
})
