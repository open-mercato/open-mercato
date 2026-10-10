/** @jest-environment node */
/**
 * The fleet half of the reported defect: a vehicle is identified by its plate and
 * by the sequence number the fleet numbers it by, and neither may repeat.
 *
 * `sequenceNumber` is nullable — a fleet that does not number its vehicles is not
 * forced to — so the interesting cases are the ones that decide when "no
 * sequence" is a value and when it is an absence.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertFleetVehicleIdentityUnique } from '../fleetService'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

const findOneMock = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string, fallback?: string) => fallback ?? key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const em = { findOne: (...args: unknown[]) => findOneMock(...args) } as unknown as EntityManager

describe('assertFleetVehicleIdentityUnique', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneMock.mockResolvedValue(null)
  })

  it('accepts a plate and sequence nothing else uses', async () => {
    await expect(
      assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: '0001' }),
    ).resolves.toBeUndefined()
    expect(findOneMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a duplicate plate', async () => {
    findOneMock.mockResolvedValueOnce({ id: 'existing' })

    await expect(
      assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: '0001' }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another vehicle already uses this plate number.' },
    })
  })

  it('refuses a duplicate sequence number with its own message', async () => {
    findOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' })

    await expect(
      assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'N E W 0001', sequenceNumber: '123456789' }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another vehicle already uses this sequence number.' },
    })
  })

  it('treats an absent or blank sequence as no sequence, not as a value to match', async () => {
    await assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: null })
    expect(findOneMock).toHaveBeenCalledTimes(1)

    findOneMock.mockClear()
    await assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: '   ' })
    expect(findOneMock).toHaveBeenCalledTimes(1)
    expect(findOneMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sequenceNumber: '' }),
    )
  })

  it('scopes the lookup to the organization', async () => {
    await assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: '0001' })

    for (const call of findOneMock.mock.calls) {
      expect(call[1]).toMatchObject({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    }
  })

  it('lets an update keep its own values by excluding the edited row', async () => {
    await assertFleetVehicleIdentityUnique(em, scope, {
      plateNumber: 'A B C 1234',
      sequenceNumber: '0001',
      excludeId: 'row-being-edited',
    })

    for (const call of findOneMock.mock.calls) {
      expect(call[1]).toMatchObject({ id: { $ne: 'row-being-edited' } })
    }
  })

  it('throws a CrudHttpError so the route maps it to a 409 body', async () => {
    findOneMock.mockResolvedValueOnce({ id: 'existing' })
    await expect(
      assertFleetVehicleIdentityUnique(em, scope, { plateNumber: 'dup' }),
    ).rejects.toBeInstanceOf(CrudHttpError)
  })
})
