import { updatePersonCompanyLink } from '../personCompanies'

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
