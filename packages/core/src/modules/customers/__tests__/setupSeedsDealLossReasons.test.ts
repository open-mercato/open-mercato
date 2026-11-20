/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

jest.mock('@open-mercato/core/modules/feature_toggles/data/entities', () => ({
  FeatureToggle: 'FeatureToggle',
}))

jest.mock('../cli', () => ({
  ensureCustomerCustomFieldDefinitions: jest.fn(async () => undefined),
  seedCustomerDictionaries: jest.fn(async () => undefined),
  seedCurrencyDictionary: jest.fn(async () => undefined),
  seedCustomerExamples: jest.fn(async () => undefined),
  seedDefaultPipeline: jest.fn(async () => undefined),
}))

jest.mock('../commands/shared', () => ({
  ensureDictionaryEntry: jest.fn(async () => null),
}))

type Row = Record<string, unknown> & { id: string }
type SeedDefaultsContext = Parameters<NonNullable<ModuleSetupConfig['seedDefaults']>>[0]

function createFakeEntityManager() {
  const rows: Array<{ entity: unknown; row: Row }> = []
  let counter = 0
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, expected]) =>
      field === 'deletedAt' ? (row[field] ?? null) === expected : row[field] === expected,
    )
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      rows.find((item) => item.entity === entity && matches(item.row, where))?.row ?? null,
    ),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) =>
      rows.filter((item) => item.entity === entity && matches(item.row, where)).map((item) => item.row),
    ),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      counter += 1
      const row: Row = { ...data, id: `created-${counter}` }
      rows.push({ entity, row })
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, rows }
}

describe('customers setup seedDefaults', () => {
  it('seeds the deal loss-reason dictionary without relying on the sales module', async () => {
    const { setup } = (await import('../setup')) as { setup: ModuleSetupConfig }
    const { em, rows } = createFakeEntityManager()

    const seedContext = {
      em,
      tenantId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      organizationId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      container: {},
    } as unknown as SeedDefaultsContext

    await setup.seedDefaults?.(seedContext)

    const dictionaries = rows.filter((item) => item.entity === 'Dictionary').map((item) => item.row)
    expect(dictionaries).toEqual([
      expect.objectContaining({ key: 'sales.deal_loss_reason', isSystem: true, managerVisibility: 'hidden' }),
    ])
    const entryValues = rows
      .filter((item) => item.entity === 'DictionaryEntry')
      .map((item) => item.row.value)
    expect(entryValues).toEqual(
      expect.arrayContaining(['lost_to_competitor', 'no_budget', 'no_decision', 'timing', 'other']),
    )
  })
})
