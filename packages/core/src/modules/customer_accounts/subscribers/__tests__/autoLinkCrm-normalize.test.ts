/** @jest-environment node */

import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

class CustomerEntity {}
class CustomerPersonProfile {}

jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerEntity,
  CustomerPersonProfile,
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ error: jest.fn() }) }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const personEntityId = '44444444-4444-4444-8444-444444444444'
const companyEntityId = '55555555-5555-4555-8555-555555555555'
const linkedPersonId = '66666666-6666-4666-8666-666666666666'
const otherOrganizationId = '77777777-7777-4777-8777-777777777777'
const otherOrgPersonId = '88888888-8888-4888-8888-888888888888'

type EmMock = {
  findOne: jest.Mock
  nativeUpdate: jest.Mock
}

function makeCtx(em: EmMock) {
  return {
    resolve: (<T = unknown>(name: string) => {
      if (name === 'em') return em as unknown as T
      return undefined as unknown as T
    }),
    eventName: 'customer_accounts.user.created',
  }
}

describe('autoLinkCrm — poisoned customerEntityId normalization (#4362)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('replaces a person-pointing customerEntityId with the person profile company', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: linkedPersonId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) return { id: linkedPersonId, kind: 'person' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: companyEntityId },
    )
  })

  it('clears a person-pointing customerEntityId when no company can be recovered', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: linkedPersonId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) return { id: linkedPersonId, kind: 'person' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => null),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: null },
    )
  })

  it('clears a customerEntityId that does not resolve inside the user own org', async () => {
    // customerEntityId is the portal company scope key, so a cross-org value must
    // be cleared, not left in place "because it is a company somewhere".
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: companyEntityId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) return null
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => null),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: null },
    )
  })

  it('does not adopt a recovered company that belongs to another org', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: linkedPersonId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: any) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) {
        // The ownership probe filters on kind:'company' — miss it to simulate a
        // profile company sitting outside the user's organization.
        if (where?.kind === 'company') return null
        return { id: linkedPersonId, kind: 'person' }
      }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: null },
    )
  })

  it('leaves a correct company customerEntityId untouched', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: companyEntityId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) return { id: companyEntityId, kind: 'company' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => null),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('scopes the person profile lookup by tenant and organization', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: linkedPersonId }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity) return { id: linkedPersonId, kind: 'person' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.findOne).toHaveBeenCalledWith(CustomerPersonProfile, {
      entity: linkedPersonId,
      tenantId,
      organizationId,
    })
  })
})

describe('autoLinkCrm — CRM auto-link path scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockResolvedValue([])
  })

  // The fifth argument of findWithDecryption is a decryption scope, not a filter,
  // so only the `where` clause keeps the candidate lookup inside the user's org.
  // These mocks apply the `where` the way the database would.
  function mockPersonEntities(rows: Array<Record<string, unknown>>) {
    mockFindWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: any) => (
      rows.filter((row) => !where?.organizationId || row.organizationId === where.organizationId)
    ))
  }

  it('does not link a CRM person that belongs to another organization', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId: null, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => (
      entity === CustomerUser ? user : null
    ))
    mockPersonEntities([
      { id: otherOrgPersonId, kind: 'person', organizationId: otherOrganizationId, primaryEmail: 'a@b.co' },
    ])
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      CustomerEntity,
      expect.objectContaining({ tenantId, organizationId, kind: 'person' }),
      expect.anything(),
      expect.anything(),
    )
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('links an in-org CRM person together with its in-org company', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId: null, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: any) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity && where?.kind === 'company') return { id: companyEntityId, kind: 'company' }
      return null
    })
    mockPersonEntities([
      { id: linkedPersonId, kind: 'person', organizationId, primaryEmail: 'A@B.co' },
    ])
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { personEntityId: linkedPersonId, customerEntityId: companyEntityId },
    )
  })

  it('links the person but not a company that sits outside the user org', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId: null, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => (
      entity === CustomerUser ? user : null
    ))
    mockPersonEntities([
      { id: linkedPersonId, kind: 'person', organizationId, primaryEmail: 'a@b.co' },
    ])
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { personEntityId: linkedPersonId },
    )
  })
})

describe('autoLinkCrm — person-invited users get a company scope key (#4362)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('derives customerEntityId from the linked person profile', async () => {
    // These users accept with personEntityId already set, so the email-matching
    // path never runs for them and customerEntityId would stay null forever.
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: any) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity && where?.kind === 'company') return { id: companyEntityId, kind: 'company' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: { id: companyEntityId } })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.findOne).toHaveBeenCalledWith(CustomerPersonProfile, {
      entity: personEntityId,
      tenantId,
      organizationId,
    })
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: companyEntityId },
    )
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('reads the profile company relation in its raw id form too', async () => {
    // MikroORM hands back either an entity reference or the bare uuid depending on
    // whether the relation is loaded; both must resolve to the same company.
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown, where: any) => {
      if (entity === CustomerUser) return user
      if (entity === CustomerEntity && where?.kind === 'company') return { id: companyEntityId, kind: 'company' }
      return null
    })
    const em: EmMock = {
      findOne: jest.fn(async () => ({ company: companyEntityId })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: userId, tenantId, organizationId },
      { customerEntityId: companyEntityId },
    )
  })

  it('writes nothing when the linked person has no in-org company', async () => {
    const user = { id: userId, tenantId, organizationId, email: 'a@b.co', personEntityId, customerEntityId: null }
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => (
      entity === CustomerUser ? user : null
    ))
    const em: EmMock = {
      findOne: jest.fn(async () => null),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })
})
