import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../data/entities'
import {
  filterActivePersonCompanyLinks,
  withActiveCustomerPersonCompanyLinkFilter,
} from './personCompanyLinkTable'

export type PersonCompanySummary = {
  linkId: string | null
  companyId: string
  displayName: string
  isPrimary: boolean
  synthetic?: boolean
}

export async function findDeletedPersonCompanyLink(
  em: EntityManager,
  person: CustomerEntity,
  company: CustomerEntity,
): Promise<CustomerPersonCompanyLink | null> {
  const link = await findOneWithDecryption(
    em,
    CustomerPersonCompanyLink,
    {
      person,
      company,
      organizationId: person.organizationId,
      tenantId: person.tenantId,
      deletedAt: { $ne: null },
    } as any,
    {},
    { tenantId: person.tenantId, organizationId: person.organizationId },
  )
  return link ?? null
}

async function requireCompany(
  em: EntityManager,
  companyId: string,
  organizationId: string,
  tenantId: string,
): Promise<CustomerEntity> {
  const company = await findOneWithDecryption(em, CustomerEntity, { id: companyId, kind: 'company', deletedAt: null }, {}, { tenantId, organizationId })
  if (!company) {
    throw new CrudHttpError(404, { error: 'Company not found' })
  }
  if (company.organizationId !== organizationId || company.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cannot link company outside current scope' })
  }
  return company
}

export async function loadPersonCompanyLinks(
  em: EntityManager,
  person: CustomerEntity,
): Promise<CustomerPersonCompanyLink[]> {
  const where = await withActiveCustomerPersonCompanyLinkFilter(
    em,
    { person, organizationId: person.organizationId, tenantId: person.tenantId },
    'customers.personCompanies.loadPersonCompanyLinks',
  )
  return filterActivePersonCompanyLinks(
    await findWithDecryption(
      em,
      CustomerPersonCompanyLink,
      where,
      { populate: ['company'], orderBy: { isPrimary: 'desc', createdAt: 'asc' } },
      { tenantId: person.tenantId, organizationId: person.organizationId },
    ),
  )
}

export function summarizePersonCompanies(
  profile: CustomerPersonProfile | null,
  links: CustomerPersonCompanyLink[],
): PersonCompanySummary[] {
  if (links.length > 0) {
    const items: PersonCompanySummary[] = []
    links.forEach((link) => {
      const company = typeof link.company === 'string' ? null : link.company
      if (!company) return
      items.push({
        linkId: link.id,
        companyId: company.id,
        displayName: company.displayName,
        isPrimary: Boolean(link.isPrimary),
      })
    })
    return items
  }

  const fallbackCompany = profile?.company && typeof profile.company !== 'string' ? profile.company : null
  if (!fallbackCompany) return []

  return [
    {
      linkId: fallbackCompany.id,
      companyId: fallbackCompany.id,
      displayName: fallbackCompany.displayName,
      isPrimary: true,
      synthetic: true,
    },
  ]
}

async function clearPrimaryFlags(em: EntityManager, person: CustomerEntity): Promise<void> {
  await em.nativeUpdate(
    CustomerPersonCompanyLink,
    { person, organizationId: person.organizationId, tenantId: person.tenantId, isPrimary: true },
    { isPrimary: false },
  )
}

function resolveLinkedCompany(link: CustomerPersonCompanyLink): CustomerEntity | null {
  return typeof link.company === 'string' ? null : link.company
}

export async function promoteFallbackPrimaryLink(
  em: EntityManager,
  person: CustomerEntity,
  profile: CustomerPersonProfile,
  links: CustomerPersonCompanyLink[],
  removedCompanyId?: string | null,
): Promise<void> {
  const nextPrimary = links[0] ?? null
  if (!nextPrimary) {
    if (
      !removedCompanyId
      || (profile.company && typeof profile.company !== 'string' && profile.company.id === removedCompanyId)
      || profile.company == null
    ) {
      profile.company = null
    }
    return
  }

  await clearPrimaryFlags(em, person)
  nextPrimary.isPrimary = true
  const nextCompany = resolveLinkedCompany(nextPrimary)
  if (nextCompany) {
    profile.company = nextCompany
  }
}

export async function syncLegacyPrimaryCompanyLink(
  em: EntityManager,
  person: CustomerEntity,
  profile: CustomerPersonProfile,
  companyId: string | null | undefined,
): Promise<void> {
  const normalizedCompanyId = typeof companyId === 'string' && companyId.trim().length > 0 ? companyId.trim() : null
  const existingLinks = await loadPersonCompanyLinks(em, person)

  if (!normalizedCompanyId) {
    if (existingLinks.some((link) => link.isPrimary)) {
      await clearPrimaryFlags(em, person)
    }
    profile.company = null
    return
  }

  const company = await requireCompany(em, normalizedCompanyId, person.organizationId, person.tenantId)
  const currentLink =
    existingLinks.find((link) => (typeof link.company === 'string' ? link.company : link.company.id) === company.id) ?? null

  if (currentLink) {
    if (!currentLink.isPrimary) {
      await clearPrimaryFlags(em, person)
      currentLink.isPrimary = true
    } else if (existingLinks.some((link) => link.id !== currentLink.id && link.isPrimary)) {
      await clearPrimaryFlags(em, person)
      currentLink.isPrimary = true
    }
  } else {
    await clearPrimaryFlags(em, person)
    const link = em.create(CustomerPersonCompanyLink, {
      organizationId: person.organizationId,
      tenantId: person.tenantId,
      person,
      company,
      isPrimary: true,
    })
    em.persist(link)
  }

  profile.company = company
}

export async function addPersonCompanyLink(
  em: EntityManager,
  person: CustomerEntity,
  profile: CustomerPersonProfile,
  companyId: string,
  options?: { isPrimary?: boolean },
): Promise<CustomerPersonCompanyLink> {
  const company = await requireCompany(em, companyId, person.organizationId, person.tenantId)
  const existingLinks = await loadPersonCompanyLinks(em, person)
  const makePrimary = Boolean(options?.isPrimary) || existingLinks.length === 0
  const existing =
    existingLinks.find((link) => (typeof link.company === 'string' ? link.company : link.company.id) === company.id) ?? null

  if (existing) {
    if (makePrimary && !existing.isPrimary) {
      await clearPrimaryFlags(em, person)
      existing.isPrimary = true
      profile.company = company
    }
    return existing
  }

  if (makePrimary) {
    await clearPrimaryFlags(em, person)
  }

  const deletedLink = await findDeletedPersonCompanyLink(em, person, company)
  const link = deletedLink ?? em.create(CustomerPersonCompanyLink, {
    organizationId: person.organizationId,
    tenantId: person.tenantId,
    person,
    company,
    isPrimary: makePrimary,
  })
  if (deletedLink) {
    deletedLink.deletedAt = null
    deletedLink.isPrimary = makePrimary
  }
  em.persist(link)

  if (makePrimary) {
    profile.company = company
  } else if (!profile.company && existingLinks.length === 0) {
    profile.company = company
    link.isPrimary = true
  }

  return link
}

export async function updatePersonCompanyLink(
  em: EntityManager,
  person: CustomerEntity,
  profile: CustomerPersonProfile,
  linkId: string,
  patch: { isPrimary?: boolean },
): Promise<CustomerPersonCompanyLink | null> {
  const existingLinks = await loadPersonCompanyLinks(em, person)
  const link = existingLinks.find((entry) => entry.id === linkId)
    ?? existingLinks.find((entry) => (typeof entry.company === 'string' ? entry.company : entry.company.id) === linkId)
    ?? null

  if (!link && profile.company && typeof profile.company !== 'string' && profile.company.id === linkId && patch.isPrimary === false) {
    profile.company = null
    return null
  }

  if (!link) {
    throw new CrudHttpError(404, { error: 'Company link not found' })
  }

  if (patch.isPrimary === true) {
    await clearPrimaryFlags(em, person)
    link.isPrimary = true
    const company = resolveLinkedCompany(link)
    if (company) {
      profile.company = company
    }
  } else if (patch.isPrimary === false) {
    const linkWasPrimary = link.isPrimary
    const removedCompanyId = typeof link.company === 'string' ? link.company : link.company.id
    link.isPrimary = false
    if (linkWasPrimary) {
      const remainingLinks = existingLinks.filter((entry) => entry.id !== link.id)
      await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, removedCompanyId)
    } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === removedCompanyId) {
      profile.company = null
    }
  }

  return link
}

export async function removePersonCompanyLink(
  em: EntityManager,
  person: CustomerEntity,
  profile: CustomerPersonProfile,
  linkId: string,
): Promise<void> {
  const existingLinks = await loadPersonCompanyLinks(em, person)
  const link = existingLinks.find((entry) => entry.id === linkId)
    ?? existingLinks.find((entry) => (typeof entry.company === 'string' ? entry.company : entry.company.id) === linkId)
    ?? null

  if (!link) {
    if (profile.company && typeof profile.company !== 'string' && profile.company.id === linkId) {
      profile.company = null
      return
    }
    throw new CrudHttpError(404, { error: 'Company link not found' })
  }

  const removedCompanyId = typeof link.company === 'string' ? link.company : link.company.id
  const removedWasPrimary = link.isPrimary
  link.isPrimary = false
  link.deletedAt = new Date()
  const remainingLinks = existingLinks.filter((entry) => entry.id !== link.id)

  if (removedWasPrimary) {
    await promoteFallbackPrimaryLink(em, person, profile, remainingLinks, removedCompanyId)
  } else if (profile.company && typeof profile.company !== 'string' && profile.company.id === removedCompanyId) {
    const primary = remainingLinks.find((entry) => entry.isPrimary) ?? null
    const primaryCompany = primary ? resolveLinkedCompany(primary) : null
    if (primaryCompany) {
      profile.company = primaryCompany
    }
  }
}
