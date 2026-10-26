import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import {
  buildXeroCompanyIndexes,
  createLazyXeroCompanyIndexes,
  loadXeroCompanyIndexSources,
  normalizeCompanyName,
  normalizeTaxNumber,
  XERO_INDEX_CHUNK_SIZE,
  type XeroCompanyIndexSources,
} from '../lib/contacts/indexes'

const mockFindWithDecryption = jest.fn()
const mockDecrypt = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/customFieldValues'),
  resolveTenantEncryptionService: () => ({ kind: 'encryption-service' }),
  decryptCustomFieldValue: (...args: unknown[]) => mockDecrypt(...args),
}))

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const ORG = 'a3b1c2d3-0000-4000-8000-000000000001'
const OTHER_ORG = 'a3b1c2d3-0000-4000-8000-000000000002'

function entityId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function company(index: number, displayName: string | null, minutesAfterEpoch = index) {
  return { entityId: entityId(index), createdAt: new Date(minutesAfterEpoch * 60_000), displayName }
}

function sources(partial: Partial<XeroCompanyIndexSources>): XeroCompanyIndexSources {
  return { companies: [], markers: [], taxNumbers: [], ...partial }
}

beforeEach(() => {
  mockFindWithDecryption.mockReset()
  mockDecrypt.mockReset()
})

describe('normalization', () => {
  it('strips whitespace and uppercases tax numbers', () => {
    expect(normalizeTaxNumber(' gb 123 456\t789 ')).toBe('GB123456789')
    expect(normalizeTaxNumber('   ')).toBeNull()
    expect(normalizeTaxNumber(null)).toBeNull()
  })

  it('lowercases names, strips punctuation and collapses whitespace', () => {
    expect(normalizeCompanyName('ACME  LTD.')).toBe('acme ltd')
    expect(normalizeCompanyName('Acme Ltd')).toBe('acme ltd')
    expect(normalizeCompanyName('O\'Brien & Sons, Inc.')).toBe('obrien sons inc')
    expect(normalizeCompanyName(' ... ')).toBeNull()
  })
})

describe('buildXeroCompanyIndexes', () => {
  it('finds a marked Company only while it has no mapping and the run has not claimed it, oldest first', () => {
    const mapped = new Set([entityId(1)])
    const indexes = buildXeroCompanyIndexes(
      sources({
        companies: [company(1, 'A', 1), company(2, 'B', 5), company(3, 'C', 3)],
        markers: [
          { entityId: entityId(1), value: `${ORG}:contact-1` },
          { entityId: entityId(2), value: `${ORG}:contact-1` },
          { entityId: entityId(3), value: `${ORG}:contact-1` },
          { entityId: entityId(2), value: `${OTHER_ORG}:contact-2` },
        ],
      }),
      (id) => mapped.has(id),
    )

    expect(indexes.findMarked(`${ORG}:contact-1`)).toBe(entityId(3))
    indexes.markClaimed(entityId(3))
    expect(indexes.findMarked(`${ORG}:contact-1`)).toBe(entityId(2))
    mapped.add(entityId(2))
    expect(indexes.findMarked(`${ORG}:contact-1`)).toBeNull()
    expect(indexes.findMarked(`${ORG}:contact-2`)).toBeNull()
  })

  it('answers every unmapped Company with the normalized tax number, oldest first, so a caller sees an ambiguity', () => {
    const mapped = new Set([entityId(4)])
    const indexes = buildXeroCompanyIndexes(
      sources({
        companies: [company(1, 'A', 9), company(2, 'B', 2), company(3, 'C', 4), company(4, 'D', 1)],
        taxNumbers: [
          { entityId: entityId(1), value: 'gb 123' },
          { entityId: entityId(2), value: 'GB123' },
          { entityId: entityId(3), value: 'GB 999' },
          { entityId: entityId(4), value: 'GB123' },
        ],
      }),
      (id) => mapped.has(id),
    )

    expect(indexes.findByTaxNumber('GB123', `${ORG}:contact-1`)).toEqual([entityId(2), entityId(1)])
    indexes.markClaimed(entityId(2))
    expect(indexes.findByTaxNumber('GB123', `${ORG}:contact-1`)).toEqual([entityId(1)])
    expect(indexes.findByTaxNumber('GB999', `${ORG}:contact-1`)).toEqual([entityId(3)])
    expect(indexes.findByTaxNumber('NOPE', `${ORG}:contact-1`)).toEqual([])
  })

  it('skips a Company marked for another Contact of the same Xero Organisation, but not one marked by an earlier Organisation', () => {
    const indexes = buildXeroCompanyIndexes(
      sources({
        companies: [company(1, 'A', 1), company(2, 'B', 2), company(3, 'C', 3)],
        markers: [
          { entityId: entityId(1), value: `${ORG}:contact-2` },
          { entityId: entityId(2), value: `${OTHER_ORG}:contact-9` },
          { entityId: entityId(3), value: `${ORG}:contact-1` },
        ],
        taxNumbers: [
          { entityId: entityId(1), value: 'GB123' },
          { entityId: entityId(2), value: 'GB123' },
          { entityId: entityId(3), value: 'GB123' },
        ],
      }),
      () => false,
    )

    expect(indexes.findByTaxNumber('GB123', `${ORG}:contact-1`)).toEqual([entityId(2), entityId(3)])
    expect(indexes.findByTaxNumber('GB123', `${ORG}:contact-2`)).toEqual([entityId(1), entityId(2)])
  })

  it('remembers the first Contact that claimed a tax number', () => {
    const indexes = buildXeroCompanyIndexes(sources({}), () => false)

    expect(indexes.taxNumberClaimedBy('GB123')).toBeNull()
    indexes.recordTaxNumberClaim('GB123', 'contact-1')
    indexes.recordTaxNumberClaim('GB123', 'contact-2')
    expect(indexes.taxNumberClaimedBy('GB123')).toBe('contact-1')
  })

  it('finds Companies by normalized name, mapped or not, including Companies the run created', () => {
    const indexes = buildXeroCompanyIndexes(
      sources({ companies: [company(1, 'Acme Ltd', 3), company(2, 'ACME LTD.', 1), company(3, null), company(4, 'Other')] }),
      (id) => id === entityId(1),
    )

    expect(indexes.findByName('acme, ltd')).toEqual([entityId(2), entityId(1)])
    indexes.addCompanyName(entityId(9), 'Acme Ltd')
    expect(indexes.findByName('Acme Ltd')).toEqual([entityId(2), entityId(1), entityId(9)])
    expect(indexes.findByName('   ')).toEqual([])
  })
})

describe('createLazyXeroCompanyIndexes', () => {
  it('loads once, on first use, and retries after a failed load', async () => {
    const load = jest
      .fn<Promise<XeroCompanyIndexSources>, []>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(sources({ companies: [company(1, 'Acme')] }))
    const indexes = createLazyXeroCompanyIndexes(load, () => false)

    expect(load).not.toHaveBeenCalled()
    await expect(indexes()).rejects.toThrow('database unavailable')
    const built = await indexes()
    expect(await indexes()).toBe(built)
    expect(load).toHaveBeenCalledTimes(2)
    expect(built.findByName('acme')).toEqual([entityId(1)])
  })
})

describe('loadXeroCompanyIndexSources', () => {
  const fork = jest.fn(() => ({}))
  const em = { fork } as unknown as EntityManager

  beforeEach(() => fork.mockClear())

  function companyRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({ id: entityId(index + 1), createdAt: new Date(index), displayName: `Company ${index + 1}` }))
  }

  it('reads Companies in keyset chunks of 500, resolves values through their profile and decrypts tax numbers', async () => {
    const companies = companyRows(XERO_INDEX_CHUNK_SIZE * 2 + 1)
    const profileIds = Array.from({ length: 600 }, (_, index) => `profile-${index + 1}`)
    const valueRows = [
      { recordId: 'profile-1', fieldKey: 'xero_contact_id', valueText: `${ORG}:contact-1`, valueMultiline: null },
      { recordId: 'profile-2', fieldKey: 'xero_tax_number', valueText: 'ciphertext', valueMultiline: null },
      { recordId: 'profile-3', fieldKey: 'xero_tax_number', valueText: 'GB 777', valueMultiline: null },
      ...profileIds.slice(3, 599).map((recordId) => ({ recordId, fieldKey: 'xero_tax_number', valueText: null, valueMultiline: null })),
      { recordId: 'profile-600', fieldKey: 'xero_contact_id', valueText: `${ORG}:contact-9`, valueMultiline: null },
      { recordId: 'profile-deleted', fieldKey: 'xero_contact_id', valueText: `${ORG}:contact-x`, valueMultiline: null },
    ].map((row, index) => ({ id: entityId(10_000 + index), ...row }))
    const entityByProfile: Record<string, string> = {
      'profile-1': entityId(1),
      'profile-2': entityId(2),
      'profile-3': entityId(3),
      'profile-600': entityId(600),
      'profile-deleted': 'deleted-company',
    }
    mockFindWithDecryption.mockImplementation(async (_em, entity, where: Record<string, unknown>, options: Record<string, unknown>, findScope) => {
      expect(findScope).toEqual(scope)
      expect(where).toMatchObject({ organizationId: scope.organizationId, tenantId: scope.tenantId })
      if (entity === CustomerEntity) {
        expect(where).toMatchObject({ kind: 'company', deletedAt: null })
        expect(options).toMatchObject({ orderBy: { id: 'asc' }, limit: XERO_INDEX_CHUNK_SIZE })
        const afterId = (where.id as { $gt: string } | undefined)?.$gt
        const start = afterId ? companies.findIndex((row) => row.id === afterId) + 1 : 0
        return companies.slice(start, start + XERO_INDEX_CHUNK_SIZE)
      }
      if (entity === CustomFieldValue) {
        expect(where).toMatchObject({ entityId: 'customers:customer_company_profile', deletedAt: null, fieldKey: { $in: ['xero_contact_id', 'xero_tax_number'] } })
        expect(options).toMatchObject({ orderBy: { id: 'asc' }, limit: XERO_INDEX_CHUNK_SIZE })
        const afterId = (where.id as { $gt: string } | undefined)?.$gt
        const start = afterId ? valueRows.findIndex((row) => row.id === afterId) + 1 : 0
        return valueRows.slice(start, start + XERO_INDEX_CHUNK_SIZE)
      }
      if (entity === CustomerCompanyProfile) {
        const ids = (where.id as { $in: string[] }).$in
        expect(ids.length).toBeLessThanOrEqual(XERO_INDEX_CHUNK_SIZE)
        return ids.filter((id) => entityByProfile[id]).map((id) => ({ id, entity: { id: entityByProfile[id] } }))
      }
      throw new Error(`[internal] unexpected entity ${String(entity)}`)
    })
    mockDecrypt.mockImplementation(async (value: unknown) => (value === 'ciphertext' ? 'GB 123' : value))

    const loaded = await loadXeroCompanyIndexSources(em, scope)

    const calls = mockFindWithDecryption.mock.calls.map((call) => call[1])
    expect(calls.filter((entity) => entity === CustomerEntity)).toHaveLength(3)
    expect(calls.filter((entity) => entity === CustomFieldValue)).toHaveLength(2)
    expect(calls.filter((entity) => entity === CustomerCompanyProfile)).toHaveLength(2)
    expect(loaded.companies).toHaveLength(XERO_INDEX_CHUNK_SIZE * 2 + 1)
    expect(loaded.companies[0]).toEqual({ entityId: entityId(1), createdAt: new Date(0), displayName: 'Company 1' })
    expect(loaded.markers).toEqual([
      { entityId: entityId(1), value: `${ORG}:contact-1` },
      { entityId: entityId(600), value: `${ORG}:contact-9` },
    ])
    expect(loaded.taxNumbers).toEqual([
      { entityId: entityId(2), value: 'GB 123' },
      { entityId: entityId(3), value: 'GB 777' },
    ])
    expect(mockDecrypt).toHaveBeenCalledWith('ciphertext', scope.tenantId, { kind: 'encryption-service' }, expect.any(Map), { kind: 'text' })
    expect(mockDecrypt).toHaveBeenCalledTimes(2)
  })

  it('reads every chunk of Companies, values and profiles through a fresh fork, so the caller\'s identity map stays empty', async () => {
    const companies = companyRows(XERO_INDEX_CHUNK_SIZE + 1)
    mockFindWithDecryption.mockImplementation(async (_em, entity, where: Record<string, unknown>) => {
      if (entity === CustomerEntity) {
        const afterId = (where.id as { $gt: string } | undefined)?.$gt
        const start = afterId ? companies.findIndex((row) => row.id === afterId) + 1 : 0
        return companies.slice(start, start + XERO_INDEX_CHUNK_SIZE)
      }
      if (entity === CustomFieldValue) return [{ recordId: 'profile-1', fieldKey: 'xero_contact_id', valueText: `${ORG}:contact-1`, valueMultiline: null }]
      return [{ id: 'profile-1', entity: { id: entityId(1) } }]
    })

    await loadXeroCompanyIndexSources(em, scope)

    const chunkCalls = mockFindWithDecryption.mock.calls
    expect(chunkCalls).toHaveLength(4)
    expect(fork).toHaveBeenCalledTimes(4)
    expect(fork.mock.calls.every((call) => (call as unknown[])[0] && ((call as unknown[])[0] as { clear?: boolean }).clear === true)).toBe(true)
    const usedEms = chunkCalls.map((call) => call[0])
    expect(usedEms).not.toContain(em)
    expect(new Set(usedEms).size).toBe(4)
  })

  it('reads one chunk of Companies and no profiles for an organization without Xero values', async () => {
    mockFindWithDecryption.mockImplementation(async (_em, entity) => (entity === CustomerEntity ? companyRows(2) : []))

    const loaded = await loadXeroCompanyIndexSources(em, scope)

    expect(loaded).toEqual({ companies: expect.any(Array), markers: [], taxNumbers: [] })
    expect(loaded.companies).toHaveLength(2)
    expect(mockFindWithDecryption.mock.calls.map((call) => call[1])).toEqual([CustomerEntity, CustomFieldValue])
  })
})
