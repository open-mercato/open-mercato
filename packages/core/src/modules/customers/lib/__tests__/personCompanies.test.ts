import { updatePersonCompanyLink, loadCompanyPeopleUnion } from '../personCompanies'
import { CustomerPersonCompanyLink, CustomerPersonProfile } from '../../data/entities'

describe('personCompanies primary-company invariants', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  function createLink(id: string, companyId: string, name: string, isPrimary: boolean) {
    return {
      id,
      isPrimary,
      company: {
        id: companyId,
        displayName: name,
      },
    }
  }

  it('promotes another linked company when demoting the current primary link', async () => {
    const primaryLink = createLink('link-primary', 'company-primary', 'Primary Co', true)
    const secondaryLink = createLink('link-secondary', 'company-secondary', 'Secondary Co', false)
    const em = {
      find: jest.fn().mockResolvedValue([primaryLink, secondaryLink]),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    }
    const person = { organizationId, tenantId }
    const profile = { company: primaryLink.company }

    await updatePersonCompanyLink(em as any, person as any, profile as any, 'link-primary', { isPrimary: false })

    expect(primaryLink.isPrimary).toBe(false)
    expect(secondaryLink.isPrimary).toBe(true)
    expect(profile.company).toBe(secondaryLink.company)
  })

  it('clears the legacy primary company when demoting the only linked company', async () => {
    const primaryLink = createLink('link-primary', 'company-primary', 'Primary Co', true)
    const em = {
      find: jest.fn().mockResolvedValue([primaryLink]),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    }
    const person = { organizationId, tenantId }
    const profile = { company: primaryLink.company }

    await updatePersonCompanyLink(em as any, person as any, profile as any, 'link-primary', { isPrimary: false })

    expect(primaryLink.isPrimary).toBe(false)
    expect(profile.company).toBeNull()
  })

  it('switches the primary company when another existing link is promoted', async () => {
    const primaryLink = createLink('link-primary', 'company-primary', 'Primary Co', true)
    const secondaryLink = createLink('link-secondary', 'company-secondary', 'Secondary Co', false)
    const em = {
      find: jest.fn().mockResolvedValue([primaryLink, secondaryLink]),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    }
    const person = { organizationId, tenantId }
    const profile = { company: primaryLink.company }

    await updatePersonCompanyLink(em as any, person as any, profile as any, 'link-secondary', { isPrimary: true })

    expect(secondaryLink.isPrimary).toBe(true)
    expect(profile.company).toBe(secondaryLink.company)
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ organizationId, tenantId, isPrimary: true }),
      { isPrimary: false },
    )
  })
})

describe('loadCompanyPeopleUnion', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const company = { id: 'company-1', tenantId, organizationId }

  it('includes profile-only company assignments that have no link row (#5114)', async () => {
    const linkedPerson = {
      id: 'person-linked',
      kind: 'person',
      deletedAt: null,
      personProfile: { jobTitle: 'CTO' },
    }
    const link = { person: linkedPerson, createdAt: new Date('2026-01-01'), deletedAt: null }

    const profileOnlyPerson = { id: 'person-profile-only', kind: 'person', deletedAt: null }
    const profileOnlyEntry = { entity: profileOnlyPerson, createdAt: new Date('2026-02-01') }

    const em = {
      find: jest.fn((EntityClass: unknown) => {
        if (EntityClass === CustomerPersonCompanyLink) return Promise.resolve([link])
        if (EntityClass === CustomerPersonProfile) return Promise.resolve([profileOnlyEntry])
        return Promise.resolve([])
      }),
    }

    const result = await loadCompanyPeopleUnion(em as any, company as any, { tenantId, organizationId })

    expect(result.map((entry) => entry.entity.id).sort()).toEqual(['person-linked', 'person-profile-only'])
    const profileOnly = result.find((entry) => entry.entity.id === 'person-profile-only')
    expect(profileOnly?.profile).toBe(profileOnlyEntry)
    expect(profileOnly?.linkedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('prefers the link row over a duplicate profile-only entry for the same person', async () => {
    const person = { id: 'person-1', kind: 'person', deletedAt: null, personProfile: { jobTitle: 'CTO' } }
    const link = { person, createdAt: new Date('2026-01-01'), deletedAt: null }
    const profileEntry = { entity: person, createdAt: new Date('2026-02-01') }

    const em = {
      find: jest.fn((EntityClass: unknown) => {
        if (EntityClass === CustomerPersonCompanyLink) return Promise.resolve([link])
        if (EntityClass === CustomerPersonProfile) return Promise.resolve([profileEntry])
        return Promise.resolve([])
      }),
    }

    const result = await loadCompanyPeopleUnion(em as any, company as any, { tenantId, organizationId })

    expect(result).toHaveLength(1)
    expect(result[0].profile).toEqual({ jobTitle: 'CTO' })
  })
})
