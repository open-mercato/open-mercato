import { expect, test } from '@playwright/test'
import type { Knex } from 'knex'
import type { SearchEntityConfig, SearchResult, SearchStrategy } from '../../../types'
import { createPresenterEnricher } from '../../../lib/presenter-enricher'
import { SearchService } from '../../../service'

type IndexRow = {
  entity_type: string
  entity_id: string
  doc: Record<string, unknown>
}

type ConditionBuilder = {
  where: (fieldOrCallback: unknown, value?: unknown) => ConditionBuilder
  whereIn: (field: string, values: string[]) => ConditionBuilder
  whereNull: (field: string) => ConditionBuilder
  orWhere: (callback: (builder: ConditionBuilder) => void) => ConditionBuilder
  orWhereNull: (field: string) => ConditionBuilder
}

type QueryBuilder = ConditionBuilder & {
  select: (...fields: string[]) => QueryBuilder
  then: Promise<IndexRow[]>['then']
}

function createConditionBuilder(): ConditionBuilder {
  const builder: ConditionBuilder = {
    where: (fieldOrCallback) => {
      if (typeof fieldOrCallback === 'function') {
        fieldOrCallback(createConditionBuilder())
      }
      return builder
    },
    whereIn: () => builder,
    whereNull: () => builder,
    orWhere: (callback) => {
      callback(createConditionBuilder())
      return builder
    },
    orWhereNull: () => builder,
  }

  return builder
}

function createQueryBuilder(rows: IndexRow[]): QueryBuilder {
  let query: QueryBuilder

  query = {
    where: (fieldOrCallback) => {
      if (typeof fieldOrCallback === 'function') {
        fieldOrCallback(createConditionBuilder())
      }
      return query
    },
    whereIn: () => query,
    whereNull: () => query,
    orWhere: (callback) => {
      callback(createConditionBuilder())
      return query
    },
    orWhereNull: () => query,
    select: () => query,
    then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
  }

  return query
}

function createKnex(rows: IndexRow[]): Knex {
  return ((_tableName: string) => createQueryBuilder(rows)) as unknown as Knex
}

function createStrategy(result: SearchResult): SearchStrategy {
  return {
    id: 'fulltext',
    name: 'Integration Fulltext',
    priority: 30,
    isAvailable: async () => true,
    ensureReady: async () => undefined,
    search: async () => [result],
    index: async () => undefined,
    delete: async () => undefined,
    bulkIndex: async () => undefined,
    purge: async () => undefined,
  }
}

test.describe('TC-SEARCH-002: search result navigation enrichment', () => {
  test('backfills url and links when a strategy returns a presenter without navigation metadata', async () => {
    const entityId = 'test:entity' as SearchEntityConfig['entityId']
    const recordId = 'rec-1'

    const presenterEnricher = createPresenterEnricher(
      createKnex([
        {
          entity_type: entityId,
          entity_id: recordId,
          doc: {
            id: recordId,
            name: 'Ada Lovelace',
          },
        },
      ]),
      new Map([
        [
          entityId,
          {
            entityId,
            resolveUrl: async (ctx) => `/backend/test/${String(ctx.record.id)}`,
            resolveLinks: async (ctx) => [
              {
                href: `/backend/test/${String(ctx.record.id)}/edit`,
                label: 'Edit',
                kind: 'secondary',
              },
            ],
          },
        ],
      ]),
    )

    const service = new SearchService({
      strategies: [
        createStrategy({
          entityId: entityId as SearchResult['entityId'],
          recordId,
          score: 0.9,
          source: 'fulltext',
          presenter: { title: 'Ada Lovelace' },
          links: [],
        }),
      ],
      defaultStrategies: ['fulltext'],
      presenterEnricher,
    })

    const [result] = await service.search('ada', {
      tenantId: 'tenant-1',
      strategies: ['fulltext'],
    })

    expect(result.presenter?.title).toBe('Ada Lovelace')
    expect(result.url).toBe('/backend/test/rec-1')
    expect(result.links).toEqual([
      {
        href: '/backend/test/rec-1/edit',
        label: 'Edit',
        kind: 'secondary',
      },
    ])
  })
})
