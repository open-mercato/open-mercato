/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  backfillDealLossReasonDictionary,
  DEAL_LOSS_REASON_DEFAULTS,
  DEAL_LOSS_REASON_DICTIONARY_KEY,
  seedDealLossReasons,
} from '../dealLossReasons'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const OTHER_ORGANIZATION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
const scope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

type DictionaryRow = {
  id: string
  tenantId: string
  organizationId: string
  key: string
  name: string
  isSystem?: boolean
  managerVisibility?: string
  deletedAt?: Date | null
}

type EntryRow = {
  id: string
  dictionary: DictionaryRow
  tenantId: string
  organizationId: string
  value: string
  normalizedValue: string
  label: string
  color?: string | null
  icon?: string | null
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field]
    if (field === 'deletedAt') return (actual ?? null) === expected
    return actual === expected
  })
}

function createFakeEntityManager(seed: { dictionaries?: DictionaryRow[]; entries?: EntryRow[] } = {}) {
  const dictionaries = [...(seed.dictionaries ?? [])]
  const entries = [...(seed.entries ?? [])]
  let counter = 0
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const rows: Array<Record<string, unknown>> = entity === 'Dictionary' ? dictionaries : entries
      return rows.find((row) => matches(row, where)) ?? null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      const rows: Array<Record<string, unknown>> = entity === 'Dictionary' ? dictionaries : entries
      return rows.filter((row) => matches(row, where))
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      counter += 1
      return { id: `created-${counter}`, ...data }
    }),
    persist: jest.fn((row: DictionaryRow | EntryRow) => {
      if ('key' in row) {
        if (!dictionaries.includes(row)) dictionaries.push(row)
        return
      }
      if (!entries.includes(row)) entries.push(row)
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em: em as unknown as EntityManager, dictionaries, entries }
}

function dictionaryFor(organizationId: string, id: string): DictionaryRow {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId,
    key: DEAL_LOSS_REASON_DICTIONARY_KEY,
    name: 'Deal loss reasons',
    isSystem: true,
    managerVisibility: 'hidden',
    deletedAt: null,
  }
}

describe('seedDealLossReasons', () => {
  it('keeps the dictionary key that existing tenants and stored deals use', () => {
    expect(DEAL_LOSS_REASON_DICTIONARY_KEY).toBe('sales.deal_loss_reason')
  })

  it('creates the hidden system dictionary with the default reasons for a new organization', async () => {
    const { em, dictionaries, entries } = createFakeEntityManager()

    await seedDealLossReasons(em, scope)

    expect(dictionaries).toHaveLength(1)
    expect(dictionaries[0]).toMatchObject({
      key: 'sales.deal_loss_reason',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      isSystem: true,
      managerVisibility: 'hidden',
    })
    expect(entries.map((entry) => entry.value).sort()).toEqual(
      DEAL_LOSS_REASON_DEFAULTS.map((seed) => seed.value).sort(),
    )
    expect(entries.every((entry) => entry.dictionary === dictionaries[0])).toBe(true)
  })

  it('does not duplicate the dictionary or its entries when seeded twice', async () => {
    const { em, dictionaries, entries } = createFakeEntityManager()

    await seedDealLossReasons(em, scope)
    await seedDealLossReasons(em, scope)

    expect(dictionaries).toHaveLength(1)
    expect(entries).toHaveLength(DEAL_LOSS_REASON_DEFAULTS.length)
  })

  it('reuses a dictionary previously seeded by sales and keeps tenant-specific entries', async () => {
    const existingDictionary = dictionaryFor(ORGANIZATION_ID, 'sales-seeded-dictionary')
    const customEntry: EntryRow = {
      id: 'custom-entry',
      dictionary: existingDictionary,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      value: 'price_too_high',
      normalizedValue: 'price_too_high',
      label: 'Price too high',
    }
    const existingDefault: EntryRow = {
      id: 'existing-no-budget',
      dictionary: existingDictionary,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      value: 'no_budget',
      normalizedValue: 'no_budget',
      label: 'Budget frozen',
      color: '#123456',
      icon: 'lucide:star',
    }
    const { em, dictionaries, entries } = createFakeEntityManager({
      dictionaries: [existingDictionary],
      entries: [customEntry, existingDefault],
    })

    await seedDealLossReasons(em, scope)

    expect(dictionaries).toEqual([existingDictionary])
    expect(entries).toHaveLength(DEAL_LOSS_REASON_DEFAULTS.length + 1)
    expect(entries.filter((entry) => entry.normalizedValue === 'no_budget')).toEqual([existingDefault])
    expect(existingDefault).toMatchObject({ label: 'Budget frozen', color: '#123456', icon: 'lucide:star' })
    expect(entries).toContain(customEntry)
    expect(entries.every((entry) => entry.dictionary === existingDictionary)).toBe(true)
  })

  it('revives a soft-deleted dictionary instead of inserting a second one with the same key', async () => {
    const deletedDictionary: DictionaryRow & { isActive?: boolean } = {
      ...dictionaryFor(ORGANIZATION_ID, 'soft-deleted-dictionary'),
      isActive: false,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const keptEntry: EntryRow = {
      id: 'kept-entry',
      dictionary: deletedDictionary,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      value: 'no_budget',
      normalizedValue: 'no_budget',
      label: 'No budget',
    }
    const { em, dictionaries, entries } = createFakeEntityManager({
      dictionaries: [deletedDictionary],
      entries: [keptEntry],
    })

    await seedDealLossReasons(em, scope)

    expect(dictionaries).toEqual([deletedDictionary])
    expect(deletedDictionary.deletedAt).toBeNull()
    expect(deletedDictionary.isActive).toBe(true)
    expect(entries).toHaveLength(DEAL_LOSS_REASON_DEFAULTS.length)
    expect(entries.filter((entry) => entry.normalizedValue === 'no_budget')).toEqual([keptEntry])
    expect(entries.every((entry) => entry.dictionary === deletedDictionary)).toBe(true)
  })

  it('fills a missing color and icon on an existing default entry', async () => {
    const existingDictionary = dictionaryFor(ORGANIZATION_ID, 'sales-seeded-dictionary')
    const bareDefault: EntryRow = {
      id: 'bare-timing',
      dictionary: existingDictionary,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      value: 'timing',
      normalizedValue: 'timing',
      label: 'Bad timing',
      color: null,
      icon: null,
    }
    const { em } = createFakeEntityManager({ dictionaries: [existingDictionary], entries: [bareDefault] })

    await seedDealLossReasons(em, scope)

    const timingDefault = DEAL_LOSS_REASON_DEFAULTS.find((seed) => seed.value === 'timing')
    expect(bareDefault).toMatchObject({ color: timingDefault?.color, icon: timingDefault?.icon })
  })

  it('seeds each organization separately', async () => {
    const otherDictionary = dictionaryFor(OTHER_ORGANIZATION_ID, 'other-org-dictionary')
    const { em, dictionaries, entries } = createFakeEntityManager({ dictionaries: [otherDictionary] })

    await seedDealLossReasons(em, scope)

    expect(dictionaries).toHaveLength(2)
    const created = dictionaries.find((dictionary) => dictionary.organizationId === ORGANIZATION_ID)
    expect(created).toBeDefined()
    expect(entries.every((entry) => entry.dictionary === created && entry.organizationId === ORGANIZATION_ID)).toBe(true)
  })
})

describe('backfillDealLossReasonDictionary', () => {
  it('reports a newly created dictionary', async () => {
    const { em } = createFakeEntityManager()

    const result = await backfillDealLossReasonDictionary(em, scope)

    expect(result).toMatchObject({
      createdDictionary: true,
      revivedDictionary: false,
      seededDefaultEntries: DEAL_LOSS_REASON_DEFAULTS.length,
    })
  })

  it('reports a revived soft-deleted dictionary instead of a created one', async () => {
    const deletedDictionary: DictionaryRow = {
      ...dictionaryFor(ORGANIZATION_ID, 'soft-deleted-dictionary'),
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const { em, dictionaries } = createFakeEntityManager({ dictionaries: [deletedDictionary] })

    const result = await backfillDealLossReasonDictionary(em, scope)

    expect(dictionaries).toEqual([deletedDictionary])
    expect(result).toMatchObject({
      dictionaryId: 'soft-deleted-dictionary',
      createdDictionary: false,
      revivedDictionary: true,
    })
  })
})
