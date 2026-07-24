/** @jest-environment node */

import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn(async () => [] as unknown[])

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
      findOne: jest.fn(async () => ({ companyEntityId })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(CustomerUser, { id: userId }, { customerEntityId: companyEntityId })
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

    expect(em.nativeUpdate).toHaveBeenCalledWith(CustomerUser, { id: userId }, { customerEntityId: null })
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

    expect(em.nativeUpdate).toHaveBeenCalledWith(CustomerUser, { id: userId }, { customerEntityId: null })
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
      findOne: jest.fn(async () => ({ companyEntityId })),
      nativeUpdate: jest.fn(async () => 1),
    }
    const { default: handle } = await import('../autoLinkCrm')
    await handle({ id: userId, tenantId, organizationId }, makeCtx(em))

    expect(em.nativeUpdate).toHaveBeenCalledWith(CustomerUser, { id: userId }, { customerEntityId: null })
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
})
