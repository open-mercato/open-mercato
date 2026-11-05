const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { loadWarrantyClaimDictionaryLabel, seedWarrantyClaimDictionaries } from '../lib/dictionaries'

describe('warranty claim dictionary seeds', () => {
  it('preserves appearance customizations on existing entries', async () => {
    const dictionary = { id: 'dictionary-1' }
    const existingEntry = {
      id: 'entry-1',
      color: '#123456',
      icon: 'lucide:star',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const persist = jest.fn()
    const em = {
      findOne: jest.fn(async (entity: unknown) => entity === Dictionary ? dictionary : existingEntry),
      persist,
    } as unknown as EntityManager

    await seedWarrantyClaimDictionaries(em, { tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(existingEntry).toMatchObject({ color: '#123456', icon: 'lucide:star' })
    expect(persist).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }))
    expect((em.findOne as jest.Mock).mock.calls.some(([entity]) => entity === DictionaryEntry)).toBe(true)
  })
})

describe('scoped warranty claim dictionary label', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
  const em = {} as EntityManager

  beforeEach(() => { mockFindOneWithDecryption.mockReset() })

  it('pins both single-record reads to tenant and organization and returns only the matching entry label', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'dictionary-1' }).mockResolvedValueOnce({ label: 'Tenant exclusion' })
    await expect(loadWarrantyClaimDictionaryLabel(em, scope, 'warranty-claim-rejection-reason', 'custom-exclusion')).resolves.toBe('Tenant exclusion')
    expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(1, em, Dictionary, {
      ...scope, key: 'warranty_claims.warranty_claim_rejection_reason', isActive: true, deletedAt: null,
    }, {}, scope)
    expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(2, em, DictionaryEntry, {
      ...scope, dictionary: 'dictionary-1', value: 'custom-exclusion',
    }, {}, scope)
  })

  it('does not read entries when the scoped active dictionary is absent', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)
    await expect(loadWarrantyClaimDictionaryLabel(em, scope, 'warranty-claim-rejection-reason', 'custom-exclusion')).resolves.toBeNull()
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('returns null for an unknown dictionary value', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({ id: 'dictionary-1' }).mockResolvedValueOnce(null)
    await expect(loadWarrantyClaimDictionaryLabel(em, scope, 'warranty-claim-rejection-reason', 'unknown')).resolves.toBeNull()
  })
})
