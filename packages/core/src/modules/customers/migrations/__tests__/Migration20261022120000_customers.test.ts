import { describe, expect, jest, test } from '@jest/globals'
import { Migration20261022120000_customers } from '../Migration20261022120000_customers'

async function collectSql(direction: 'up' | 'down'): Promise<string[]> {
  const migration = Object.create(
    Migration20261022120000_customers.prototype,
  ) as Migration20261022120000_customers
  const statements: string[] = []
  Object.defineProperty(migration, 'addSql', {
    value: jest.fn((sql: string) => statements.push(sql)),
  })

  await migration[direction]()

  return statements
}

describe('Migration20261022120000_customers', () => {
  test('up() adds the pipeline flag off by default and a nullable stage default', async () => {
    await expect(collectSql('up')).resolves.toEqual([
      `alter table "customer_pipelines" add "stage_probabilities_enabled" boolean not null default false;`,
      `alter table "customer_pipeline_stages" add "default_probability" int null;`,
    ])
  })

  test('down() drops exactly the two added columns', async () => {
    await expect(collectSql('down')).resolves.toEqual([
      `alter table "customer_pipeline_stages" drop column "default_probability";`,
      `alter table "customer_pipelines" drop column "stage_probabilities_enabled";`,
    ])
  })
})
