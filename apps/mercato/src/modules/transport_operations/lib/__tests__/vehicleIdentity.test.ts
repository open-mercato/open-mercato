/** @jest-environment node */
/**
 * The rule the reported defect was about: a vehicle's plate number and VIN are
 * its identity, and two rows must not answer to either.
 *
 * The database now carries a real unique index (the entity declares it as an
 * `expression`, because the `options: { unique: true }` form emitted a plain one),
 * but the constraint alone answers a duplicate with a 500 and no field to fix.
 * These tests pin the *message*: a 409 whose text names the plate or the VIN.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertVehicleIdentityUnique } from '../transportService'

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

describe('assertVehicleIdentityUnique', () => {
  beforeEach(() => {
    findOneMock.mockReset()
    findOneMock.mockResolvedValue(null)
  })

  it('accepts a plate and VIN nothing else uses', async () => {
    await expect(
      assertVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', vin: 'VIN0001' }),
    ).resolves.toBeUndefined()
    expect(findOneMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a duplicate plate with a 409 that names the plate', async () => {
    findOneMock.mockResolvedValueOnce({ id: 'existing' })

    await expect(
      assertVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', vin: 'VIN0001' }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another vehicle already uses this plate number.' },
    })
    // The VIN check never runs: one field error is enough to fix.
    expect(findOneMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a duplicate VIN with its own message', async () => {
    findOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' })

    await expect(
      assertVehicleIdentityUnique(em, scope, { plateNumber: 'X Y Z 9999', vin: 'VIN0001' }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another vehicle already uses this VIN.' },
    })
  })

  it('refuses a duplicate fleet sequence number with its own message', async () => {
    findOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' })

    await expect(
      assertVehicleIdentityUnique(em, scope, { plateNumber: 'X Y Z 9999', sequenceNumber: '123456789' }),
    ).rejects.toMatchObject({
      status: 409,
      body: { error: 'Another vehicle already uses this sequence number.' },
    })
  })

  it('treats an absent or blank sequence as no sequence, not as a value to match', async () => {
    await assertVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234', sequenceNumber: '   ' })
    expect(findOneMock).toHaveBeenCalledTimes(1)
  })

  it('scopes the lookup to the organization, never the whole tenant', async () => {
    await assertVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234' })

    expect(findOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        plateNumber: 'A B C 1234',
        deletedAt: null,
      }),
    )
  })

  it('lets an update keep its own plate by excluding the row being edited', async () => {
    await assertVehicleIdentityUnique(em, scope, {
      plateNumber: 'A B C 1234',
      vin: 'VIN0001',
      excludeId: 'row-being-edited',
    })

    expect(findOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: { $ne: 'row-being-edited' } }),
    )
  })

  it('trims before comparing, so trailing space is not a second vehicle', async () => {
    await assertVehicleIdentityUnique(em, scope, { plateNumber: '  A B C 1234  ' })

    expect(findOneMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ plateNumber: 'A B C 1234' }),
    )
  })

  it('skips a field the caller did not send rather than matching the empty string', async () => {
    await assertVehicleIdentityUnique(em, scope, { plateNumber: 'A B C 1234' })
    expect(findOneMock).toHaveBeenCalledTimes(1)

    findOneMock.mockClear()
    await assertVehicleIdentityUnique(em, scope, { plateNumber: '   ', vin: '' })
    expect(findOneMock).not.toHaveBeenCalled()
  })

  it('throws a CrudHttpError so the route maps it to a 409 body', async () => {
    findOneMock.mockResolvedValueOnce({ id: 'existing' })
    await expect(
      assertVehicleIdentityUnique(em, scope, { plateNumber: 'dup' }),
    ).rejects.toBeInstanceOf(CrudHttpError)
  })
})
