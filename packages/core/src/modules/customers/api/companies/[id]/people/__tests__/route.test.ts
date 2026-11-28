/** @jest-environment node */

// Pins the wiring #5114 reports as broken: the company People tab must list the same
// link-row + profile-only union the badge counts, so a person whose company comes only
// from `CustomerPersonProfile.company` (no link row) has to appear in `items`. The route
// runs against the real `loadCompanyPeopleUnion` here — only the EM is faked — so a future
// edit that reverts the route to link rows only fails this test instead of silently
// restoring the bug.

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const companyId = '33333333-3333-4333-8333-333333333333'
const linkedPersonId = '44444444-4444-4444-8444-444444444444'
const profileOnlyPersonId = '55555555-5555-4555-8555-555555555555'
const linkId = '66666666-6666-4666-8666-666666666666'
const updatedAt = new Date('2026-03-03T00:00:00Z')
const getGrantedFeatures = jest.fn()

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return { getGrantedFeatures }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeGuard', () => ({
  isOrganizationReadAccessAllowed: jest.fn(() => true),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (emInstance: any, entity: unknown, where: unknown, opts?: unknown) =>
    emInstance.find(entity, where, opts),
  findOneWithDecryption: (emInstance: any, entity: unknown, where: unknown, opts?: unknown) =>
    emInstance.findOne(entity, where, opts),
}))

import { GET as listCompanyPeople } from '../route'
import { CustomerPersonCompanyLink, CustomerPersonProfile } from '../../../../../data/entities'

function makePerson(id: string, displayName: string) {
  return {
    id,
    kind: 'person',
    deletedAt: null,
    displayName,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    temperature: null,
    source: null,
    tenantId,
    organizationId,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }
}

describe('GET /api/customers/companies/{id}/people', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.findOne.mockResolvedValue({ id: companyId, kind: 'company', tenantId, organizationId, deletedAt: null })
    getGrantedFeatures.mockResolvedValue(['customers.people.view'])
  })

  it('lists people linked through a link row and through a profile-only assignment alike (#5114)', async () => {
    const linkedPerson = makePerson(linkedPersonId, 'Linked Person')
    const profileOnlyPerson = makePerson(profileOnlyPersonId, 'Profile Only Person')
    em.find.mockImplementation(async (EntityClass: unknown) => {
      if (EntityClass === CustomerPersonCompanyLink) {
        return [
          {
            id: linkId,
            person: { ...linkedPerson, personProfile: { jobTitle: 'CTO', department: 'Engineering' } },
            createdAt: new Date('2026-02-01T00:00:00Z'),
            updatedAt,
            deletedAt: null,
          },
        ]
      }
      if (EntityClass === CustomerPersonProfile) {
        return [{ entity: profileOnlyPerson, jobTitle: 'Buyer', department: null, createdAt: new Date('2026-03-01T00:00:00Z'), updatedAt }]
      }
      return []
    })

    const response = await listCompanyPeople(
      new Request(`http://localhost/api/customers/companies/${companyId}/people`),
      { params: { id: companyId } },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.total).toBe(2)
    expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [linkedPersonId, profileOnlyPersonId].sort(),
    )
    const profileOnlyItem = body.items.find((item: { id: string }) => item.id === profileOnlyPersonId)
    expect(profileOnlyItem.jobTitle).toBe('Buyer')
    expect(profileOnlyItem.linkedAt).toBe('2026-03-01T00:00:00.000Z')
    expect(profileOnlyItem).toMatchObject({ linkId: null, updatedAt: updatedAt.toISOString() })
    expect(body.items.find((item: { id: string }) => item.id === linkedPersonId)).toMatchObject({ linkId, updatedAt: updatedAt.toISOString() })
  })

  it('lists a person present in both sources once', async () => {
    const person = makePerson(linkedPersonId, 'Linked Person')
    em.find.mockImplementation(async (EntityClass: unknown) => {
      if (EntityClass === CustomerPersonCompanyLink) {
        return [{ person, createdAt: new Date('2026-02-01T00:00:00Z'), deletedAt: null }]
      }
      if (EntityClass === CustomerPersonProfile) {
        return [{ entity: person, createdAt: new Date('2026-03-01T00:00:00Z') }]
      }
      return []
    })

    const response = await listCompanyPeople(
      new Request(`http://localhost/api/customers/companies/${companyId}/people`),
      { params: { id: companyId } },
    )

    const body = await response.json()
    expect(body.total).toBe(1)
    expect(body.items[0].linkedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('pages verified former employees by departure date and omits current contact details', async () => {
    const link = (person: ReturnType<typeof makePerson>, employmentEndedOn: string) => ({
      person, employmentEndedOn, employmentStatus: 'ended', deletedAt: null, createdAt: updatedAt,
    })
    em.find.mockResolvedValue([
      link(makePerson(linkedPersonId, 'Alex'), '2024-09-03'),
      link({ ...makePerson(profileOnlyPersonId, 'Blair'), primaryEmail: 'private@example.org' }, '2024-11-04'),
      link({ ...makePerson('foreign', 'Foreign'), organizationId: 'foreign' }, '2024-11-05'),
    ])

    const response = await listCompanyPeople(
      new Request(`http://localhost/api/customers/companies/${companyId}/people?employmentStatus=ended&sort=recent&pageSize=1`),
      { params: { id: companyId } },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      total: 2,
      totalPages: 2,
      items: [{ id: profileOnlyPersonId, displayName: 'Blair', employmentEndedOn: '2024-11-04', primaryEmail: null }],
    })
    expect(em.find).toHaveBeenCalledWith(CustomerPersonCompanyLink, expect.objectContaining({
      tenantId, organizationId, deletedAt: null, employmentStatus: 'ended',
      person: { tenantId, organizationId, deletedAt: null, kind: 'person' },
    }), { populate: ['person'] })
  })

  it('requires People view permission before reading former employees', async () => {
    getGrantedFeatures.mockResolvedValue(['customers.companies.view'])
    const response = await listCompanyPeople(
      new Request(`http://localhost/api/customers/companies/${companyId}/people?employmentStatus=ended`),
      { params: { id: companyId } },
    )

    expect(response.status).toBe(403)
    expect(em.find).not.toHaveBeenCalled()
  })
})
