/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import { resolveBookingParty } from '../lib/bookingRecords'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const PERSON = '30000000-0000-4000-8000-000000000001'
const COMPANY = '30000000-0000-4000-8000-000000000002'
const OTHER_COMPANY = '30000000-0000-4000-8000-000000000003'
const USER = '40000000-0000-4000-8000-000000000001'
const SECOND_USER = '40000000-0000-4000-8000-000000000002'

function seedParty(): FakeEm {
  const em = new FakeEm()
  em.seed(CustomerEntity, { id: PERSON, ...scope, kind: 'person', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', deletedAt: null } as never)
  em.seed(CustomerPersonProfile, { id: 'profile-1', ...scope, entity: PERSON, company: COMPANY } as never)
  return em
}

function seedUser(em: FakeEm, id: string, data: Record<string, unknown> = {}) {
  em.seed(CustomerUser, { id, ...scope, personEntityId: PERSON, customerEntityId: COMPANY, isActive: true, deletedAt: null, ...data } as never)
}

function withModules(ids: string[]) {
  registerModules(ids.map((id): Module => ({ id, features: [] })))
}

describe('resolveBookingParty portal user', () => {
  afterEach(() => withModules(['customers', 'customer_accounts']))

  it('links the booking person’s only portal account when the caller passes none', async () => {
    withModules(['customers', 'customer_accounts'])
    const em = seedParty()
    seedUser(em, USER)

    const party = await resolveBookingParty(em as never, scope, { bookedByPersonId: PERSON, customerCompanyId: COMPANY })

    expect(party).toEqual({ bookedByPersonId: PERSON, customerCompanyId: COMPANY, customerUserId: USER })
  })

  it('leaves the portal user empty when the person has none, several, or only inactive or other-company accounts', async () => {
    withModules(['customers', 'customer_accounts'])
    const none = seedParty()
    expect((await resolveBookingParty(none as never, scope, { bookedByPersonId: PERSON })).customerUserId).toBeNull()

    const ambiguous = seedParty()
    seedUser(ambiguous, USER)
    seedUser(ambiguous, SECOND_USER, { customerEntityId: null })
    expect((await resolveBookingParty(ambiguous as never, scope, { bookedByPersonId: PERSON, customerCompanyId: COMPANY })).customerUserId).toBeNull()

    const unusable = seedParty()
    seedUser(unusable, USER, { isActive: false })
    seedUser(unusable, SECOND_USER, { customerEntityId: OTHER_COMPANY })
    expect((await resolveBookingParty(unusable as never, scope, { bookedByPersonId: PERSON, customerCompanyId: COMPANY })).customerUserId).toBeNull()

    const otherOrganization = seedParty()
    seedUser(otherOrganization, USER, { organizationId: '22222222-2222-4222-8222-999999999999' })
    expect((await resolveBookingParty(otherOrganization as never, scope, { bookedByPersonId: PERSON })).customerUserId).toBeNull()
  })

  it('without customer_accounts, books without a portal user and rejects a passed one with 422', async () => {
    withModules(['customers'])
    const em = seedParty()
    seedUser(em, USER)

    expect((await resolveBookingParty(em as never, scope, { bookedByPersonId: PERSON })).customerUserId).toBeNull()
    await expect(resolveBookingParty(em as never, scope, { bookedByPersonId: PERSON, customerUserId: USER })).rejects.toMatchObject({
      status: 422,
      body: expect.objectContaining({ fieldErrors: { customerUserId: 'property_management.errors.customerUserNotFound' } }),
    })
    await expect(resolveBookingParty(em as never, scope, { bookedByPersonId: PERSON, customerUserId: USER })).rejects.toBeInstanceOf(CrudHttpError)
  })
})
