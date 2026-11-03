import {
  countCompanyPeopleUnion,
  loadCompanyPeopleUnion,
  removePersonCompanyLink,
  updatePersonCompanyLink,
} from '../personCompanies'
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

describe('countCompanyPeopleUnion', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const company = { id: 'company-1', tenantId, organizationId }

  function createEm(links: unknown[], profiles: unknown[]) {
    const calls: Array<{ entity: unknown; where: Record<string, unknown>; options: Record<string, unknown> }> = []
    const em = {
      find: jest.fn((EntityClass: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => {
        calls.push({ entity: EntityClass, where, options })
        if (EntityClass === CustomerPersonCompanyLink) return Promise.resolve(links)
        if (EntityClass === CustomerPersonProfile) return Promise.resolve(profiles)
        return Promise.resolve([])
      }),
    }
    return { em, calls }
  }

  it('counts the same union the list resolves, de-duplicating people present in both sources', async () => {
    const { em } = createEm(
      [
        { person: { id: 'person-linked' }, deletedAt: null },
        { person: { id: 'person-both' }, deletedAt: null },
      ],
      [{ entity: { id: 'person-both' } }, { entity: { id: 'person-profile-only' } }],
    )

    await expect(countCompanyPeopleUnion(em as any, company as any)).resolves.toBe(3)
  })

  it('counts without hydrating people — projects the foreign keys and filters persons in SQL', async () => {
    const { em, calls } = createEm([{ person: 'person-linked', deletedAt: null }], [{ entity: 'person-profile-only' }])

    await expect(countCompanyPeopleUnion(em as any, company as any)).resolves.toBe(2)

    const linkCall = calls.find((call) => call.entity === CustomerPersonCompanyLink)
    expect(linkCall?.where).toMatchObject({
      company: company.id,
      tenantId,
      organizationId,
      deletedAt: null,
      person: { kind: 'person', deletedAt: null },
    })
    expect(linkCall?.options).toEqual({ fields: ['person', 'deletedAt'] })

    const profileCall = calls.find((call) => call.entity === CustomerPersonProfile)
    expect(profileCall?.where).toMatchObject({
      company: company.id,
      tenantId,
      organizationId,
      entity: { kind: 'person', deletedAt: null },
    })
    expect(profileCall?.options).toEqual({ fields: ['entity'] })
  })

  it('drops soft-deleted link rows that slipped past the query filter', async () => {
    const { em } = createEm(
      [
        { person: { id: 'person-active' }, deletedAt: null },
        { person: { id: 'person-detached' }, deletedAt: new Date('2026-03-01') },
      ],
      [],
    )

    await expect(countCompanyPeopleUnion(em as any, company as any)).resolves.toBe(1)
  })
})

describe('removePersonCompanyLink — profile-only assignment (#5114)', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111'
  const organizationId = '22222222-2222-4222-8222-222222222222'

  it('promotes the remaining primary link instead of leaving the person without a company', async () => {
    const primaryLink = {
      id: 'link-primary',
      isPrimary: true,
      company: { id: 'company-linked', displayName: 'Linked Co' },
    }
    const em = {
      find: jest.fn().mockResolvedValue([primaryLink]),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    }
    const person = { organizationId, tenantId }
    const profile = { company: { id: 'company-profile-only', displayName: 'Legacy Co' } }

    await removePersonCompanyLink(em as any, person as any, profile as any, 'company-profile-only')

    expect(profile.company).toBe(primaryLink.company)
  })

  it('clears the legacy company when no link remains', async () => {
    const em = {
      find: jest.fn().mockResolvedValue([]),
      nativeUpdate: jest.fn().mockResolvedValue(1),
    }
    const person = { organizationId, tenantId }
    const profile = { company: { id: 'company-profile-only', displayName: 'Legacy Co' } }

    await removePersonCompanyLink(em as any, person as any, profile as any, 'company-profile-only')

    expect(profile.company).toBeNull()
  })
})
