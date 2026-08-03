/** @jest-environment node */
import { backfillDealLossReasonDictionary } from '../dictionaries'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

type DictionaryRow = {
  id: string
  tenantId: string
  organizationId: string
  key: string
  name: string
  description?: string | null
  isSystem?: boolean
  isActive?: boolean
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
  position?: number
  isDefault?: boolean
  deletedAt?: Date | null
}

function createFakeEntityManager(seed: {
  dictionaries?: DictionaryRow[]
  entries?: EntryRow[]
}) {
  const dictionaries = [...(seed.dictionaries ?? [])]
  const entries = [...(seed.entries ?? [])]
  let dictionaryCounter = 0
  let entryCounter = 0

  const em = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === 'Dictionary') {
        return dictionaries.find((dictionary) =>
          (where.id === undefined || dictionary.id === where.id) &&
          (where.tenantId === undefined || dictionary.tenantId === where.tenantId) &&
          (where.organizationId === undefined || dictionary.organizationId === where.organizationId) &&
          (where.key === undefined || dictionary.key === where.key) &&
          (where.deletedAt === undefined || (dictionary.deletedAt ?? null) === where.deletedAt)
        ) ?? null
      }
      if (entity === 'DictionaryEntry') {
        return entries.find((entry) =>
          (where.id === undefined || entry.id === where.id) &&
          (where.dictionary === undefined || entry.dictionary === where.dictionary) &&
          (where.tenantId === undefined || entry.tenantId === where.tenantId) &&
          (where.organizationId === undefined || entry.organizationId === where.organizationId) &&
          (where.normalizedValue === undefined || entry.normalizedValue === where.normalizedValue) &&
          (where.deletedAt === undefined || (entry.deletedAt ?? null) === where.deletedAt)
        ) ?? null
      }
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity !== 'DictionaryEntry') return []
      return entries.filter((entry) =>
        (where.dictionary === undefined || entry.dictionary === where.dictionary) &&
        (where.tenantId === undefined || entry.tenantId === where.tenantId) &&
        (where.organizationId === undefined || entry.organizationId === where.organizationId) &&
        (where.deletedAt === undefined || (entry.deletedAt ?? null) === where.deletedAt)
      )
    }),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      if (entity === 'Dictionary') {
        dictionaryCounter += 1
        return {
          id: `created-dictionary-${dictionaryCounter}`,
          ...data,
        } as DictionaryRow
      }
      entryCounter += 1
      return {
        id: `created-entry-${entryCounter}`,
        ...data,
      } as EntryRow
    }),
    persist: jest.fn((entity: DictionaryRow | EntryRow) => {
      if ('key' in entity) {
        if (!dictionaries.some((dictionary) => dictionary.id === entity.id)) dictionaries.push(entity)
        return
      }
      if (!entries.some((entry) => entry.id === entity.id)) entries.push(entity)
    }),
    flush: jest.fn(async () => undefined),
  }

  return { em: em as unknown as any, dictionaries, entries }
}

describe('backfillDealLossReasonDictionary', () => {
  it('creates the sales loss reason dictionary and copies legacy entries', async () => {
    const legacyDictionary: DictionaryRow = {
      id: 'legacy-dictionary',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      key: 'customer_lost_reason',
      name: 'Customer lost reason',
      deletedAt: null,
    }
    const { em, dictionaries, entries } = createFakeEntityManager({
      dictionaries: [legacyDictionary],
      entries: [
        {
          id: 'legacy-price',
          dictionary: legacyDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'Price',
          normalizedValue: 'price',
          label: 'Price',
          color: '#ef4444',
          icon: 'lucide:tag',
        },
        {
          id: 'legacy-no-response',
          dictionary: legacyDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'No response',
          normalizedValue: 'no response',
          label: 'No response',
        },
      ],
    })

    const result = await backfillDealLossReasonDictionary(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })

    const targetDictionary = dictionaries.find((dictionary) => dictionary.key === 'sales.deal_loss_reason')
    expect(targetDictionary).toBeTruthy()
    expect(result.createdDictionary).toBe(true)
    expect(result.copiedLegacyEntries).toBe(2)
    expect(entries.filter((entry) => entry.dictionary === targetDictionary).map((entry) => entry.value)).toEqual([
      'Price',
      'No response',
    ])
  })

  it('does not overwrite an existing target dictionary with entries', async () => {
    const targetDictionary: DictionaryRow = {
      id: 'target-dictionary',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      key: 'sales.deal_loss_reason',
      name: 'Deal loss reasons',
      deletedAt: null,
    }
    const legacyDictionary: DictionaryRow = {
      id: 'legacy-dictionary',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      key: 'customer_lost_reason',
      name: 'Customer lost reason',
      deletedAt: null,
    }
    const { em, entries } = createFakeEntityManager({
      dictionaries: [targetDictionary, legacyDictionary],
      entries: [
        {
          id: 'target-other',
          dictionary: targetDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'Other',
          normalizedValue: 'other',
          label: 'Other',
        },
        {
          id: 'legacy-price',
          dictionary: legacyDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'Price',
          normalizedValue: 'price',
          label: 'Price',
        },
      ],
    })

    const result = await backfillDealLossReasonDictionary(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })

    expect(result.createdDictionary).toBe(false)
    expect(result.existingEntries).toBe(1)
    expect(result.copiedLegacyEntries).toBe(0)
    expect(entries.filter((entry) => entry.dictionary === targetDictionary).map((entry) => entry.value)).toEqual(['Other'])
  })

  it('skips duplicate legacy values when copying entries', async () => {
    const targetDictionary: DictionaryRow = {
      id: 'target-dictionary',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      key: 'sales.deal_loss_reason',
      name: 'Deal loss reasons',
      deletedAt: null,
    }
    const legacyDictionary: DictionaryRow = {
      id: 'legacy-dictionary',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      key: 'customer_lost_reason',
      name: 'Customer lost reason',
      deletedAt: null,
    }
    const { em, entries } = createFakeEntityManager({
      dictionaries: [targetDictionary, legacyDictionary],
      entries: [
        {
          id: 'legacy-price-1',
          dictionary: legacyDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'Price',
          normalizedValue: 'price',
          label: 'Price',
        },
        {
          id: 'legacy-price-2',
          dictionary: legacyDictionary,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          value: 'price',
          normalizedValue: 'price',
          label: 'Price duplicate',
        },
      ],
    })

    const result = await backfillDealLossReasonDictionary(em, {
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })

    expect(result.copiedLegacyEntries).toBe(1)
    expect(entries.filter((entry) => entry.dictionary === targetDictionary).map((entry) => entry.value)).toEqual(['Price'])
  })
})
