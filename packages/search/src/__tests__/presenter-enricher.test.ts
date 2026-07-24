
import type { Kysely } from 'kysely'
import type { SearchEntityConfig } from '../types'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { SearchResult } from '@open-mercato/shared/modules/search'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { decryptIndexDocForSearch } from '@open-mercato/shared/lib/encryption/indexDoc'
import { createPresenterEnricher } from '../lib/presenter-enricher'

jest.mock('@open-mercato/shared/lib/encryption/indexDoc', () => ({
  decryptIndexDocForSearch: jest.fn(),
}))

type IndexRow = {
  entity_type: string
  entity_id: string
  doc: Record<string, unknown>
}

const mockedDecryptIndexDocForSearch = jest.mocked(decryptIndexDocForSearch)

/**
 * Build a minimal Kysely-like mock for `db.selectFrom(...).select(...).where(...).execute()` chains.
 * The presenter enricher only uses selectFrom/select/where/execute on the resolved Kysely instance,
 * so we don't need full coverage here.
 */
function createKyselyMock(rows: IndexRow[]): Kysely<any> {
  const chain: any = {
    select: jest.fn(() => chain),
    where: jest.fn(() => chain),
    execute: jest.fn().mockResolvedValue(rows),
  }
  const db: any = {
    selectFrom: jest.fn(() => chain),
  }
  return db as Kysely<any>
}

function createConfig(config: Omit<SearchEntityConfig, 'entityId'> & { entityId?: SearchEntityConfig['entityId'] }): SearchEntityConfig {
  return {
    entityId: (config.entityId ?? 'customers:person') as SearchEntityConfig['entityId'],
    ...config,
  }
}

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    entityId: 'customers:person',
    recordId: 'person-1',
    score: 0.8,
    source: 'tokens',
    ...overrides,
  }
}

describe('createPresenterEnricher', () => {
  beforeEach(() => {
    mockedDecryptIndexDocForSearch.mockReset()
  })

  it('uses search config presenters and the stored organization scope for doc decryption', async () => {
    const decryptedDoc = {
      id: 'person-1',
      name: 'Ada Lovelace',
      organization_id: 'org-from-doc',
      'cf:nickname': 'Countess',
    }
    mockedDecryptIndexDocForSearch.mockResolvedValue(decryptedDoc)

    const queryEngine = { query: jest.fn() } as unknown as QueryEngine
    const buildSource = jest.fn().mockResolvedValue({
      text: 'Ada Lovelace',
      presenter: {
        title: 'Ada Lovelace',
        subtitle: 'Countess',
        badge: 'Person',
      },
      links: [{ href: '/backend/customers/person-1/edit', label: 'Edit', kind: 'secondary' as const }],
    })
    const resolveUrl = jest.fn().mockResolvedValue('/backend/customers/person-1')
    const config = createConfig({ buildSource, resolveUrl })

    const enrich = createPresenterEnricher(
      createKyselyMock([{ entity_type: 'customers:person', entity_id: 'person-1', doc: decryptedDoc }]),
      new Map([[config.entityId, config]]),
      queryEngine,
      {} as never,
    )

    const [enriched] = await enrich([createResult()], 'tenant-1', null)

    expect(mockedDecryptIndexDocForSearch).toHaveBeenCalledWith(
      'customers:person',
      decryptedDoc,
      { tenantId: 'tenant-1', organizationId: 'org-from-doc' },
      expect.anything(),
      expect.any(Map),
    )
    expect(buildSource).toHaveBeenCalledWith(
      expect.objectContaining({
        record: decryptedDoc,
        customFields: { nickname: 'Countess' },
        tenantId: 'tenant-1',
        organizationId: null,
        queryEngine,
      }),
    )
    expect(resolveUrl).toHaveBeenCalled()
    expect(enriched.presenter).toEqual({
      title: 'Ada Lovelace',
      subtitle: 'Countess',
      badge: 'Person',
    })
    expect(enriched.url).toBe('/backend/customers/person-1')
    expect(enriched.links).toEqual([{ href: '/backend/customers/person-1/edit', label: 'Edit', kind: 'secondary' }])
  })

  it('replaces empty link arrays with resolved links when url metadata is missing', async () => {
    const doc = {
      id: 'person-1',
      name: 'Ada Lovelace',
      organization_id: 'org-1',
    }
    mockedDecryptIndexDocForSearch.mockResolvedValue(doc)

    const resolveLinks = jest.fn().mockResolvedValue([
      { href: '/backend/customers/person-1', label: 'View', kind: 'primary' as const },
    ])
    const config = createConfig({ resolveLinks })

    const enrich = createPresenterEnricher(
      createKyselyMock([{ entity_type: 'customers:person', entity_id: 'person-1', doc }]),
      new Map([[config.entityId, config]]),
    )

    const [enriched] = await enrich([
      createResult({
        presenter: { title: 'Ada Lovelace' },
        links: [],
      }),
    ], 'tenant-1', 'org-1')

    expect(resolveLinks).toHaveBeenCalled()
    expect(enriched.links).toEqual([{ href: '/backend/customers/person-1', label: 'View', kind: 'primary' }])
  })

  it('re-renders a result that already has a stored presenter when the entity has a config', async () => {
    const doc = { id: 'rec-1', display_name: 'Ada' }
    mockedDecryptIndexDocForSearch.mockResolvedValue(doc)

    const formatResult = jest.fn(async () => ({ title: 'Fresh Title', badge: 'Fresh' }))
    const config = createConfig({
      entityId: 'customers:customer_person_profile' as EntityId,
      enabled: true,
      formatResult,
    })
    const entityConfigMap = new Map<EntityId, SearchEntityConfig>([[config.entityId, config]])
    const db = createKyselyMock([
      { entity_type: 'customers:customer_person_profile', entity_id: 'rec-1', doc },
    ])

    const enrich = createPresenterEnricher(db, entityConfigMap)
    const results: SearchResult[] = [{
      entityId: 'customers:customer_person_profile' as EntityId,
      recordId: 'rec-1',
      score: 1,
      source: 'fulltext',
      presenter: { title: 'Stale English Title' },
      url: '/x',
    }]

    const [enriched] = await enrich(results, 'tenant-1', null)

    expect(formatResult).toHaveBeenCalledTimes(1)
    expect(enriched.presenter?.title).toBe('Fresh Title')
  })

  it('keeps the stored presenter when the entity has no config', async () => {
    const db = createKyselyMock([])
    const enrich = createPresenterEnricher(db, new Map(), undefined)
    const results: SearchResult[] = [{
      entityId: 'unknown:thing' as EntityId,
      recordId: 'rec-9',
      score: 1,
      source: 'fulltext',
      presenter: { title: 'Stored' },
      url: '/y',
    }]

    const [enriched] = await enrich(results, 'tenant-1', null)
    expect(enriched.presenter?.title).toBe('Stored')
  })
})
