import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import handle from '../autoLinkCrmReverse'

const mockFindOneWithDecryption = jest.fn()
const mockLoggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/aes', () => ({
  lookupHashCandidates: (email: string) => [email],
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: (...args: unknown[]) => mockLoggerError(...args) }) }),
}))

class CustomerEntity {}
class CustomerPersonProfile {}

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerEntity,
  CustomerPersonProfile,
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const personEntityId = '44444444-4444-4444-8444-444444444444'
const companyEntityId = '55555555-5555-4555-8555-555555555555'
const otherScopeId = '66666666-6666-4666-8666-666666666666'
const existingCompanyId = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, unknown>

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value && Array.isArray(value.$in)) {
      return value.$in.includes(row[key])
    }
    return row[key] === value
  })
}

function createScenario(options: {
  profile?: Row | null
  company?: Row
  user?: Row
  beforeUpdate?: (user: Row) => void
} = {}) {
  const person = {
    id: personEntityId, tenantId, organizationId, kind: 'person',
    primaryEmail: ' Person@Example.com ', deletedAt: null,
  }
  const company = {
    id: companyEntityId, tenantId, organizationId, kind: 'company', deletedAt: null,
    ...options.company,
  }
  const existingCompany = {
    id: existingCompanyId, tenantId, organizationId, kind: 'company', deletedAt: null,
  }
  const profile = options.profile === null ? null : {
    entity: personEntityId, tenantId, organizationId, company: { id: companyEntityId },
    ...options.profile,
  }
  const user = {
    id: userId, tenantId, organizationId, emailHash: 'person@example.com',
    deletedAt: null, personEntityId: null, customerEntityId: null,
    ...options.user,
  }
  mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: Row) => (
    entity === CustomerEntity ? [person, company, existingCompany].find((row) => matches(row, where)) ?? null : null
  ))
  const em = {
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === CustomerUser) return matches(user, where) ? user : null
      if (entity === CustomerPersonProfile) return profile && matches(profile, where) ? profile : null
      throw new Error('[internal] Unexpected entity lookup')
    }),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Row, updates: Row) => {
      options.beforeUpdate?.(user)
      if (!matches(user, where)) return 0
      Object.assign(user, updates)
      return 1
    }),
  }
  const ctx = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as unknown as T
      throw new Error('[internal] Unexpected dependency')
    },
  }
  return { em, ctx, user }
}

describe('reverse CRM subscriber with the company ownership resolver (#7861)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    expect(mockLoggerError).not.toHaveBeenCalled()
  })

  it.each([
    ['entity reference', { id: companyEntityId }],
    ['raw ID', companyEntityId],
  ])('links the person and company from the %s', async (_label, company) => {
    const { em, ctx, user } = createScenario({ profile: { company } })

    await handle({ id: personEntityId, tenantId, organizationId }, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, personEntityId: null, customerEntityId: null },
      { personEntityId, customerEntityId: companyEntityId },
    )
    expect(user).toMatchObject({ personEntityId, customerEntityId: companyEntityId })
    expect(em.findOne).toHaveBeenCalledWith(CustomerPersonProfile, {
      entity: personEntityId, tenantId, organizationId,
    })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      CustomerEntity,
      { id: companyEntityId, tenantId, organizationId, kind: 'company', deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
  })

  it.each([
    ['absent profile', null],
    ['absent company', { company: null }],
    ['profile in another tenant', { tenantId: otherScopeId }],
    ['profile in another organization', { organizationId: otherScopeId }],
  ])('links only the person with %s', async (_label, profile) => {
    const { em, ctx, user } = createScenario({ profile })

    await handle({ id: personEntityId, tenantId, organizationId }, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(user).toMatchObject({ personEntityId, customerEntityId: null })
  })

  it.each([
    ['another tenant', { tenantId: otherScopeId }],
    ['another organization', { organizationId: otherScopeId }],
    ['soft-deleted', { deletedAt: new Date('2026-10-01') }],
    ['a person', { kind: 'person' }],
    ['missing', { id: otherScopeId }],
  ])('rejects a company that is %s', async (_label, company) => {
    const { em, ctx, user } = createScenario({ company })

    await handle({ id: personEntityId, tenantId, organizationId }, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(user).toMatchObject({ personEntityId, customerEntityId: null })
  })

  it('derives the company lookup scope from the persisted portal account', async () => {
    const { em, ctx, user } = createScenario()

    await handle({ id: personEntityId, tenantId, organizationId: otherScopeId }, ctx)

    expect(em.findOne).toHaveBeenCalledWith(CustomerPersonProfile, {
      entity: personEntityId, tenantId, organizationId,
    })
    expect(user.customerEntityId).toBe(companyEntityId)
  })

  it('preserves an existing company link while linking the person', async () => {
    const { em, ctx, user } = createScenario({ user: { customerEntityId: existingCompanyId } })

    await handle({ id: personEntityId, tenantId, organizationId }, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, personEntityId: null },
      { personEntityId },
    )
    expect(user.customerEntityId).toBe(existingCompanyId)
    expect(em.findOne.mock.calls.some(([entity]) => entity === CustomerPersonProfile)).toBe(false)
  })

  it('preserves a company assigned concurrently and still links the person', async () => {
    const { em, ctx, user } = createScenario({
      beforeUpdate: (record) => { record.customerEntityId = existingCompanyId },
    })
    const payload = { id: personEntityId, tenantId, organizationId }

    await handle(payload, ctx)
    await handle(payload, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(em.nativeUpdate).toHaveBeenNthCalledWith(
      1,
      CustomerUser,
      { id: userId, personEntityId: null, customerEntityId: null },
      { personEntityId, customerEntityId: companyEntityId },
    )
    expect(em.nativeUpdate).toHaveBeenNthCalledWith(
      2,
      CustomerUser,
      { id: userId, personEntityId: null },
      { personEntityId },
    )
    expect(user).toMatchObject({ personEntityId, customerEntityId: existingCompanyId })
  })

  it('does not overwrite a person link assigned by another worker', async () => {
    const { em, ctx, user } = createScenario({
      beforeUpdate: (record) => { record.personEntityId = otherScopeId },
    })

    await handle({ id: personEntityId, tenantId, organizationId }, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(2)
    expect(user).toMatchObject({ personEntityId: otherScopeId, customerEntityId: null })
  })

  it('does not write again when the creation event is replayed', async () => {
    const { em, ctx, user } = createScenario()
    const payload = { id: personEntityId, tenantId, organizationId }

    await handle(payload, ctx)
    await handle(payload, ctx)

    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(user).toMatchObject({ personEntityId, customerEntityId: companyEntityId })
  })
})
