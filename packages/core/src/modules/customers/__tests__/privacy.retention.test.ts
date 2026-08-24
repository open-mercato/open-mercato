import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { PrivacyRetentionInput } from '@open-mercato/shared/lib/privacy'
import { CustomerEntity } from '../data/entities'
import { CustomerPeoplePrivacyHandler, buildCustomerPeopleRetentionFilter } from '../privacy'

const mockFindAndCountWithDecryption = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindEntityIdsBySearchTokens = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/search/tokenLookup', () => ({
  findEntityIdsBySearchTokens: (...args: unknown[]) => mockFindEntityIdsBySearchTokens(...args),
}))

const now = new Date('2026-08-24T12:00:00.000Z')
const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const commandContext = { container: {} } as CommandRuntimeContext

function retentionInput(overrides: Partial<PrivacyRetentionInput> = {}): PrivacyRetentionInput {
  return {
    scope,
    retentionDays: 365,
    action: 'anonymize',
    batchSize: 25,
    dryRun: false,
    excludedSubjects: [{ kind: 'customers:person', id: 'held-person' }],
    actorId: 'actor-user',
    commandContext,
    now,
    ...overrides,
  }
}

describe('CustomerPeoplePrivacyHandler retention', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('targets only inactive people older than the cutoff', () => {
    expect(buildCustomerPeopleRetentionFilter(retentionInput())).toEqual({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      kind: 'person',
      isActive: false,
      deletedAt: null,
      createdAt: { $lt: new Date('2025-08-24T12:00:00.000Z') },
      updatedAt: { $lt: new Date('2025-08-24T12:00:00.000Z') },
      id: { $nin: ['held-person'] },
    })
  })

  it('anonymizes a bounded batch through the subject handler', async () => {
    const people = [
      { id: 'person-1' } as CustomerEntity,
      { id: 'person-2' } as CustomerEntity,
    ]
    mockFindAndCountWithDecryption.mockResolvedValueOnce([people, 2])
    const handler = new CustomerPeoplePrivacyHandler(
      {} as EntityManager,
      { execute: jest.fn() } as unknown as CommandBus,
    )
    const anonymizeSubject = jest
      .spyOn(handler, 'anonymizeSubject')
      .mockResolvedValue({ affected: 1 })

    const result = await handler.runRetention(retentionInput({ batchSize: 2 }))

    expect(result).toEqual({ matched: 2, affected: 2, hasMore: false })
    expect(anonymizeSubject).toHaveBeenCalledTimes(2)
    expect(anonymizeSubject).toHaveBeenNthCalledWith(1, expect.objectContaining({
      subject: { kind: 'customers:person', id: 'person-1' },
      dryRun: false,
    }))
  })

  it('resolves customer people by scoped primary-email search tokens', async () => {
    const getKysely = jest.fn(() => ({ selectFrom: jest.fn() }))
    mockFindEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: true, ids: ['person-1'] })
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'person-1' } as CustomerEntity])
    const handler = new CustomerPeoplePrivacyHandler(
      { getKysely } as unknown as EntityManager,
      { execute: jest.fn() } as unknown as CommandBus,
    )

    const result = await handler.resolveSubjects({
      scope,
      identifier: { kind: 'email', value: 'person@example.com' },
      actorId: 'actor-user',
    })

    expect(result.subjects).toEqual([{ kind: 'customers:person', id: 'person-1' }])
    expect(mockFindEntityIdsBySearchTokens).toHaveBeenCalledWith(expect.objectContaining({
      query: 'person@example.com',
      fields: ['primary_email'],
      scope,
    }))
  })

  it('resolves customer people by scoped primary-phone search tokens', async () => {
    const getKysely = jest.fn(() => ({ selectFrom: jest.fn() }))
    mockFindEntityIdsBySearchTokens.mockResolvedValueOnce({ matched: true, ids: ['person-2'] })
    mockFindWithDecryption.mockResolvedValueOnce([{ id: 'person-2' } as CustomerEntity])
    const handler = new CustomerPeoplePrivacyHandler(
      { getKysely } as unknown as EntityManager,
      { execute: jest.fn() } as unknown as CommandBus,
    )

    const result = await handler.resolveSubjects({
      scope,
      identifier: { kind: 'phone', value: '+48 500 600 700' },
      actorId: 'actor-user',
    })

    expect(result.subjects).toEqual([{ kind: 'customers:person', id: 'person-2' }])
    expect(mockFindEntityIdsBySearchTokens).toHaveBeenCalledWith(expect.objectContaining({
      query: '+48 500 600 700',
      fields: ['primary_phone'],
      scope,
    }))
  })
})
