import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import handle from '../autoLinkCrmReverse'

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerEntity: class CustomerEntity {},
  CustomerPersonProfile: class CustomerPersonProfile {},
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  lookupHashCandidates: (email: string) => [`hash:${email}`],
}))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn() }) }),
}))

type Row = Record<string, unknown> & { id: string; tenantId: string; organizationId: string }

const tenantId = 'tenant-a'
const organizationId = 'organization-a'
const email = 'fixture@example.test'

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (typeof value === 'object' && value !== null && '$in' in value) {
      return (value.$in as unknown[]).includes(row[key])
    }
    return row[key] === value
  })
}

function setup() {
  const user: Row = {
    id: 'user-a', tenantId, organizationId, emailHash: `hash:${email}`,
    personEntityId: null, customerEntityId: null, deletedAt: null,
  }
  const person: Row = {
    id: 'person-a', tenantId, organizationId, kind: 'person', primaryEmail: email, deletedAt: null,
  }
  const company: Row = {
    id: 'company-a', tenantId, organizationId, kind: 'company', deletedAt: null,
  }
  const profile: Row = {
    id: 'profile-a', tenantId, organizationId, entity: { id: person.id }, company: { id: company.id },
  }
  const users = [user]
  const entities = [person, company]
  const profiles = [profile]
  let beforeUpdate: (() => void) | undefined
  const findOne = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    const rows = entity === CustomerUser ? users : entity === CustomerPersonProfile ? profiles : entities
    const row = rows.find((candidate) => matches(
      entity === CustomerPersonProfile ? { ...candidate, entity: (candidate.entity as { id: string })?.id ?? candidate.entity } : candidate,
      where,
    ))
    return row ? { ...row } : null
  })
  const nativeUpdate = jest.fn(async (_entity: unknown, where: Record<string, unknown>, updates: Record<string, unknown>) => {
    beforeUpdate?.()
    const row = users.find((candidate) => matches(candidate, where))
    if (!row) return 0
    Object.assign(row, updates)
    return 1
  })
  const em = { findOne, nativeUpdate }
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => findOne(entity, where))
  const ctx = { resolve: <T = unknown>() => em as unknown as T }
  const payload = { id: person.id, tenantId, organizationId }
  return { user, person, company, profile, users, entities, profiles, em, ctx, payload, beforeUpdate: (callback: () => void) => { beforeUpdate = callback } }
}

describe('reverse CRM auto-link organization isolation (#7852)', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['person', 'profile'] as const)('leaves a matching-email account in another organization unchanged for a %s ID event', async (idType) => {
    const fixture = setup()
    fixture.user.organizationId = 'organization-b'
    await handle({ ...fixture.payload, id: fixture[idType].id }, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.user.customerEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('uses the persisted person organization when a legacy event omits it', async () => {
    const fixture = setup()
    fixture.user.organizationId = 'organization-b'
    await handle({ id: fixture.person.id, tenantId }, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('does not link an account from another tenant', async () => {
    const fixture = setup()
    fixture.user.tenantId = 'tenant-b'
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('links the same-organization account and the owned company relation', async () => {
    const fixture = setup()
    fixture.person.primaryEmail = `  ${email.toUpperCase()}  `
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBe(fixture.company.id)
    expect(fixture.em.nativeUpdate).toHaveBeenCalledWith(CustomerUser, expect.objectContaining({
      id: fixture.user.id, tenantId, organizationId, deletedAt: null, personEntityId: null,
    }), expect.objectContaining({ personEntityId: fixture.person.id, customerEntityId: fixture.company.id }))
  })

  it('supports the profile ID emitted by the ordinary person-created event', async () => {
    const fixture = setup()
    await handle({ ...fixture.payload, id: fixture.profile.id }, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBe(fixture.company.id)
    expect(fixture.em.findOne).toHaveBeenCalledWith(CustomerPersonProfile, expect.objectContaining({
      id: fixture.profile.id, tenantId, organizationId,
    }))
  })

  it.each(['person', 'profile'] as const)('supports a legacy %s ID event without organization metadata', async (idType) => {
    const fixture = setup()
    await handle({ id: fixture[idType].id, tenantId }, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBe(fixture.company.id)
  })

  it('supports a legacy profile whose entity reference is a raw ID', async () => {
    const fixture = setup()
    fixture.profile.entity = fixture.person.id
    await handle({ ...fixture.payload, id: fixture.profile.id }, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBe(fixture.company.id)
  })

  it.each(['tenantId', 'organizationId'])('rejects an out-of-scope fallback profile by %s', async (key) => {
    const fixture = setup()
    fixture.profile[key] = 'foreign-scope'
    await handle({ ...fixture.payload, id: fixture.profile.id }, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('rejects a fallback profile pointing to a person in another organization', async () => {
    const fixture = setup()
    fixture.person.organizationId = 'organization-b'
    await handle({ ...fixture.payload, id: fixture.profile.id }, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['organizationId', 'organization-b'], ['tenantId', 'tenant-b'], ['kind', 'person'], ['deletedAt', new Date()],
  ])('does not derive a company with invalid %s', async (key, value) => {
    const fixture = setup()
    fixture.company[key as string] = value
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBeNull()
  })

  it('does not derive a company from a profile in another organization', async () => {
    const fixture = setup()
    fixture.profile.organizationId = 'organization-b'
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBeNull()
  })

  it('preserves an existing company link', async () => {
    const fixture = setup()
    fixture.user.customerEntityId = 'existing-company'
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.user.customerEntityId).toBe('existing-company')
  })

  it.each(['tenantId', 'organizationId', 'kind', 'deletedAt'])('does not link an invalid person with changed %s', async (key) => {
    const fixture = setup()
    fixture.person[key] = key === 'deletedAt' ? new Date() : 'foreign-value'
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBeNull()
    expect(fixture.em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent on repeated event delivery', async () => {
    const fixture = setup()
    await handle(fixture.payload, fixture.ctx)
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(fixture.person.id)
    expect(fixture.em.nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('allows only one of two competing person links to win', async () => {
    const fixture = setup()
    fixture.entities.push({ ...fixture.person, id: 'person-b' })
    await Promise.all([
      handle(fixture.payload, fixture.ctx),
      handle({ ...fixture.payload, id: 'person-b' }, fixture.ctx),
    ])
    const affected = await Promise.all(fixture.em.nativeUpdate.mock.results.map((result) => result.value as Promise<number>))
    expect(affected.filter((count) => count === 1)).toHaveLength(1)
    expect(['person-a', 'person-b']).toContain(fixture.user.personEntityId)
  })

  it.each([
    ['organizationId', 'organization-b'], ['tenantId', 'tenant-b'], ['deletedAt', new Date()],
    ['personEntityId', 'competing-person'], ['customerEntityId', 'concurrent-company'], ['emailHash', 'hash:changed@example.test'],
  ])('does not overwrite an account whose %s changed during lookup', async (key, value) => {
    const fixture = setup()
    fixture.beforeUpdate(() => { fixture.user[key as string] = value })
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user.personEntityId).toBe(key === 'personEntityId' ? value : null)
    expect(fixture.user.customerEntityId).toBe(key === 'customerEntityId' ? value : null)
  })

  it('recovers a company represented by a raw relation ID', async () => {
    const fixture = setup()
    fixture.profile.company = fixture.company.id
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user).toMatchObject({ personEntityId: fixture.person.id, customerEntityId: fixture.company.id })
  })

  it.each(['profile', 'company relation', 'company record'])('links only the person when the %s is missing', async (missing) => {
    const fixture = setup()
    if (missing === 'profile') fixture.profiles.length = 0
    if (missing === 'company relation') fixture.profile.company = null
    if (missing === 'company record') fixture.entities.splice(fixture.entities.indexOf(fixture.company), 1)
    await handle(fixture.payload, fixture.ctx)
    expect(fixture.user).toMatchObject({ personEntityId: fixture.person.id, customerEntityId: null })
  })
})
