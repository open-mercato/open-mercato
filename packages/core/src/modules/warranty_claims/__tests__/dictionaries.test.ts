import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { seedWarrantyClaimDictionaries } from '../lib/dictionaries'

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
