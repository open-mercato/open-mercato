import { describe, expect, jest, test } from '@jest/globals'
import { Migration } from '@mikro-orm/migrations'
import * as reindexDictionaryEntries from '../modules/dictionaries/migrations/Migration20260901120000_reindex_dictionary_entries'
import * as reindexPipelineStageColors from '../modules/customers/migrations/Migration20260901120000_reindex_pipeline_stage_colors'
import * as reindexWorkflowDefinitions from '../modules/workflows/migrations/Migration20260901120000_reindex_workflow_definitions'

type MigrationModule = {
  queryIndexReindexEntityTypes: readonly string[]
} & Record<string, unknown>

const CATCH_UP_MIGRATIONS: Array<{ label: string; module: MigrationModule; entityTypes: string[] }> = [
  {
    label: 'customers pipeline stage colors',
    module: reindexPipelineStageColors as unknown as MigrationModule,
    entityTypes: ['customers:customer_dictionary_entry'],
  },
  {
    label: 'workflow definition renames',
    module: reindexWorkflowDefinitions as unknown as MigrationModule,
    entityTypes: ['workflows:workflow_definition'],
  },
  {
    label: 'dictionary entry backfill',
    module: reindexDictionaryEntries as unknown as MigrationModule,
    entityTypes: ['dictionaries:dictionary_entry'],
  },
]

function resolveMigrationClass(module: MigrationModule): new () => Migration {
  const exported = Object.values(module).find(
    (value) => typeof value === 'function' && value.prototype instanceof Migration,
  )
  if (!exported) throw new Error('[internal] migration module exports no Migration subclass')
  return exported as new () => Migration
}

async function collectSql(module: MigrationModule, direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(resolveMigrationClass(module).prototype) as Migration
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', { value: jest.fn((sql: string) => statements.push(sql)) })
  await migration[direction]()
  return statements
}

describe('query-index catch-up migrations', () => {
  test.each(CATCH_UP_MIGRATIONS)('$label declares the entity types it repairs', ({ module, entityTypes }) => {
    expect(module.queryIndexReindexEntityTypes).toEqual(entityTypes)
  })

  test.each(CATCH_UP_MIGRATIONS)('$label executes no SQL of its own', async ({ module }) => {
    await expect(collectSql(module, 'up')).resolves.toEqual([])
    await expect(collectSql(module, 'down')).resolves.toEqual([])
  })
})
