import { describe, expect, jest, test } from '@jest/globals'
import { Migration } from '@mikro-orm/migrations'
import * as customerEntities from '../modules/customers/data/entities'
import * as dictionaryEntities from '../modules/dictionaries/data/entities'
import * as workflowEntities from '../modules/workflows/data/entities'
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

/**
 * `entities.ids.generated.ts` derives every entity id as `<moduleId>:<snake_case(exported class)>`,
 * so the module's own `data/entities.ts` reproduces the registry the query_index subscriber
 * validates against — without depending on a generated artifact this suite cannot see.
 */
const MODULE_ENTITY_EXPORTS: Record<string, Record<string, unknown>> = {
  customers: customerEntities,
  dictionaries: dictionaryEntities,
  workflows: workflowEntities,
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/(?:^_+|_+$)/g, '')
    .toLowerCase()
}

function registeredEntityTypes(moduleId: string): string[] {
  const moduleExports = MODULE_ENTITY_EXPORTS[moduleId]
  if (!moduleExports) throw new Error(`[internal] no entity exports registered for module ${moduleId}`)
  return Object.entries(moduleExports)
    .filter(([, value]) => typeof value === 'function')
    .map(([exportName]) => `${moduleId}:${toSnakeCase(exportName)}`)
}

describe('query-index catch-up migrations', () => {
  test.each(CATCH_UP_MIGRATIONS)('$label declares the entity types it repairs', ({ module, entityTypes }) => {
    expect(module.queryIndexReindexEntityTypes).toEqual(entityTypes)
  })

  test.each(CATCH_UP_MIGRATIONS)('$label declares only registered entity types', ({ entityTypes }) => {
    for (const entityType of entityTypes) {
      const [moduleId] = entityType.split(':')
      expect(registeredEntityTypes(moduleId)).toContain(entityType)
    }
  })

  test.each(CATCH_UP_MIGRATIONS)('$label executes no SQL of its own', async ({ module }) => {
    await expect(collectSql(module, 'up')).resolves.toEqual([])
    await expect(collectSql(module, 'down')).resolves.toEqual([])
  })
})
