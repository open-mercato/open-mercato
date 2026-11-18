/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity, CustomerPersonCompanyLink, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
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
import { resolveLeaseParty } from '../lib/leaseRecords'
import { resolveOrderStatusEntryId } from '../lib/salesLookups'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const otherScope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '33333333-3333-4333-8333-333333333333' }
const PERSON = '30000000-0000-4000-8000-000000000001'
const COMPANY = '30000000-0000-4000-8000-000000000002'

function seedParty(): FakeEm {
  const em = new FakeEm()
  em.seed(CustomerEntity, { id: PERSON, ...scope, kind: 'person', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', deletedAt: null, displayName: 'Acme' } as never)
  return em
}

async function fieldErrorsOf(promise: Promise<unknown>): Promise<Record<string, string>> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    return ((err as CrudHttpError).body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}
  }
  throw new Error('[internal] expected a refusal')
}

describe('person-company membership is checked within the organization', () => {
  it('ignores a person profile or company link recorded in another organization', async () => {
    const em = seedParty()
    em.seed(CustomerPersonProfile, { id: 'profile-x', ...otherScope, entity: PERSON, company: COMPANY } as never)
    em.seed(CustomerPersonCompanyLink, { id: 'link-x', ...otherScope, person: PERSON, company: COMPANY, deletedAt: null } as never)

    expect(await fieldErrorsOf(resolveBookingParty(em as never, scope, { bookedByPersonId: PERSON, customerCompanyId: COMPANY, customerUserId: null }))).toEqual({
      bookedByPersonId: 'property_management.errors.bookingPersonNotInCompany',
    })
    expect(await fieldErrorsOf(resolveLeaseParty(em as never, scope, COMPANY, PERSON))).toEqual({
      primaryContactPersonId: 'property_management.errors.contactNotInCompany',
    })
  })

  it('accepts a company link recorded in the same organization', async () => {
    const em = seedParty()
    em.seed(CustomerPersonCompanyLink, { id: 'link-1', ...scope, person: PERSON, company: COMPANY, deletedAt: null } as never)

    expect(await resolveLeaseParty(em as never, scope, COMPANY, PERSON)).toEqual({ companyId: COMPANY, companyName: 'Acme', contactPersonId: PERSON })
  })
})

describe('resolveOrderStatusEntryId', () => {
  it('matches the normalized dictionary value, as sales does', async () => {
    const em = new FakeEm()
    em.respond = (sql, params) => (sql.includes('entry.normalized_value = ?') && params[4] === 'canceled' ? [{ id: 'entry-1' }] : [])

    expect(await resolveOrderStatusEntryId(em as never, scope, '  Canceled ')).toBe('entry-1')
    expect(em.executed[0].params).toEqual([scope.organizationId, scope.tenantId, scope.organizationId, scope.tenantId, 'canceled'])
  })
})
