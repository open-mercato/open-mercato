import { assertSubjectEntityExists, isRegisteredSubjectEntityType, normalizeSubjectEntityType } from '../lib/subject-entity'

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: jest.fn(() => ({
    customers: {
      customer_company_profile: 'customers:customer_company_profile',
      customer_person_profile: 'customers:customer_person_profile',
    },
  })),
}))

describe('subject entity validation', () => {
  it('recognizes registered entity ids', () => {
    expect(isRegisteredSubjectEntityType('customers:customer_company_profile')).toBe(true)
    expect(isRegisteredSubjectEntityType('customers:customer_company')).toBe(true)
    expect(isRegisteredSubjectEntityType('customers:missing')).toBe(false)
  })

  it('normalizes legacy customer aliases to canonical profile entity ids', () => {
    expect(normalizeSubjectEntityType('customers:customer_company')).toBe('customers:customer_company_profile')
    expect(normalizeSubjectEntityType('customers:customer_person')).toBe('customers:customer_person_profile')
    expect(normalizeSubjectEntityType('customers:customer_company_profile')).toBe('customers:customer_company_profile')
  })

  it('rejects unknown entity ids before querying', async () => {
    const queryEngine = { query: jest.fn() }

    await expect(
      assertSubjectEntityExists(
        queryEngine,
        { tenantId: 't1', organizationId: 'o1' },
        'customers:missing',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('unknown subjectEntityType') },
    })

    expect(queryEngine.query).not.toHaveBeenCalled()
  })

  it('rejects missing records in a known entity', async () => {
    const queryEngine = {
      query: jest.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 1,
        total: 0,
      }),
    }

    await expect(
      assertSubjectEntityExists(
        queryEngine,
        { tenantId: 't1', organizationId: 'o1' },
        'customers:customer_company',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).rejects.toMatchObject({
      status: 404,
      body: { error: expect.stringContaining('not found') },
    })
  })

  it('queries the scoped entity and succeeds when the record exists', async () => {
    const queryEngine = {
      query: jest.fn().mockResolvedValue({
        items: [{ id: '11111111-1111-1111-1111-111111111111' }],
        page: 1,
        pageSize: 1,
        total: 1,
      }),
    }

    await expect(
      assertSubjectEntityExists(
        queryEngine,
        { tenantId: 't1', organizationId: 'o1' },
        'customers:customer_company',
        '11111111-1111-1111-1111-111111111111',
      ),
    ).resolves.toBeUndefined()

    expect(queryEngine.query).toHaveBeenCalledWith('customers:customer_company_profile', {
      fields: ['id'],
      filters: { id: { $eq: '11111111-1111-1111-1111-111111111111' } },
      page: { page: 1, pageSize: 1 },
      tenantId: 't1',
      organizationId: 'o1',
    })
  })
})
