jest.mock('awilix', () => ({
  asValue: (value: unknown) => ({ _value: value }),
}))

jest.mock('../fulltext/drivers', () => ({
  createFulltextDriver: jest.fn(() => null),
}))

import { registerSearchModule } from '../di'
import type { SearchIndexer } from '../indexer/search-indexer'
import type { SearchBuildContext, SearchModuleConfig } from '../types'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const companyEntityId = 'customers:customer_company_profile'

function createDefinitionsDatabase(rows: Array<Record<string, unknown>>) {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'where']) {
    query[method] = jest.fn(() => query)
  }
  query.execute = jest.fn(async () => rows)
  return { selectFrom: jest.fn(() => query) }
}

function createContainer(services: Record<string, unknown>) {
  const registered: Record<string, unknown> = { ...services }
  return {
    resolve: jest.fn((name: string) => {
      if (name in registered) return registered[name]
      throw new Error(`[mock] Not registered: ${name}`)
    }),
    register: jest.fn((registrations: Record<string, { _value: unknown }>) => {
      for (const [key, registration] of Object.entries(registrations)) {
        registered[key] = registration._value
      }
    }),
    registered,
  }
}

function createModuleConfigs(contexts: SearchBuildContext[]): SearchModuleConfig[] {
  return [
    {
      entities: [
        {
          entityId: companyEntityId,
          enabled: true,
          buildSource: async (ctx) => {
            contexts.push(ctx)
            return { text: 'Acme Ltd' }
          },
        },
      ],
    },
  ]
}

async function indexCompany(indexer: SearchIndexer) {
  await indexer.indexRecord({
    entityId: companyEntityId,
    recordId: 'profile-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    record: { id: 'profile-1', 'cf:tax_number': 'GB123456', 'cf:industry_note': 'Wholesale' },
    customFields: { tax_number: 'GB123456', industry_note: 'Wholesale' },
  })
}

describe('registerSearchModule encrypted custom fields wiring', () => {
  it('wires a resolver over the request entity manager into the registered indexer', async () => {
    const contexts: SearchBuildContext[] = []
    const db = createDefinitionsDatabase([{ key: 'tax_number', config_json: { encrypted: true } }])
    const container = createContainer({ em: { getKysely: () => db } })

    registerSearchModule(container as never, {
      skipTokens: true,
      skipVector: true,
      skipFulltext: true,
      moduleConfigs: createModuleConfigs(contexts),
    })
    await indexCompany(container.registered.searchIndexer as SearchIndexer)

    expect(db.selectFrom).toHaveBeenCalledWith('custom_field_defs')
    expect(contexts[0].customFields).toEqual({ industry_note: 'Wholesale' })
    expect(contexts[0].record).not.toHaveProperty('cf:tax_number')
  })

  it('reports a missing entity manager and leaves every custom field out of the build context', async () => {
    const reportError = jest.fn()
    const unregister = registerTelemetryRuntime({ reportError } as unknown as TelemetryRuntime)
    try {
      const contexts: SearchBuildContext[] = []
      const container = createContainer({})

      registerSearchModule(container as never, {
        skipTokens: true,
        skipVector: true,
        skipFulltext: true,
        moduleConfigs: createModuleConfigs(contexts),
      })
      await indexCompany(container.registered.searchIndexer as SearchIndexer)

      expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
        module: 'search',
        code: 'search.custom_field_definitions_unavailable',
      }))
      expect(contexts[0].customFields).toEqual({})
      expect(Object.keys(contexts[0].record).filter((key) => key.startsWith('cf'))).toEqual([])
    } finally {
      unregister()
    }
  })
})
