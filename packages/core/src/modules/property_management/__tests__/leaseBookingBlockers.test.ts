/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Booking } from '../data/entities'
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

import { assertNoBookingsInTerm } from '../commands/lease'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

describe('lease term booking blockers', () => {
  it('refuses with 409 lease_overlaps_bookings carrying at most 100 blockers and the total count', async () => {
    const em = new FakeEm()
    for (let index = 0; index < 130; index += 1) {
      em.seed(Booking, {
        id: `booking-${String(index).padStart(3, '0')}`,
        ...scope,
        unitId: 'unit-1',
        status: 'confirmed',
        startsAt: `2099-01-${String(1 + Math.floor(index / 10)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(2, '0')}:00:00`,
        endsAt: `2099-01-${String(1 + Math.floor(index / 10)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(2, '0')}:30:00`,
        productName: 'Meeting room',
        deletedAt: null,
      } as never)
    }
    const failure = await assertNoBookingsInTerm(em as never, scope, 'unit-1', { startsOn: '2099-01-01', endsOn: '2099-12-31' }).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(CrudHttpError)
    const body = (failure as CrudHttpError).body as { code: string; blockers: unknown[]; blockerCount: number }
    expect((failure as CrudHttpError).status).toBe(409)
    expect(body.code).toBe('lease_overlaps_bookings')
    expect(body.blockers).toHaveLength(100)
    expect(body.blockerCount).toBe(130)
  })

  it('passes when no holding booking falls inside the term', async () => {
    const em = new FakeEm()
    await expect(assertNoBookingsInTerm(em as never, scope, 'unit-1', { startsOn: '2099-01-01', endsOn: '2099-12-31' })).resolves.toBeUndefined()
  })
})
