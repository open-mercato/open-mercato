/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { FakeEm, type EntityClass, type Row, type Where } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())

import { assertReasonEntry, DEFAULT_UNAVAILABILITY_REASONS, listUnavailabilityReasons, seedUnavailabilityReasons } from '../lib/unavailabilityReasons'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }

class DictionaryEm extends FakeEm {
  create(entity: EntityClass, data: Row) {
    return super.create(entity, { ...data, id: data.id ?? randomUUID() })
  }

  async find(entity: EntityClass, where: Where, options?: Parameters<FakeEm['find']>[2]) {
    if (entity !== DictionaryEntry || typeof where.dictionary !== 'string') return super.find(entity, where, options)
    const { dictionary, ...rest } = where
    const rows = await super.find(entity, rest, options)
    return rows.filter((row) => (row.dictionary as { id?: string } | undefined)?.id === dictionary)
  }

  async findOne(entity: EntityClass, where: Where, options?: Parameters<FakeEm['findOne']>[2]) {
    if (entity !== DictionaryEntry || typeof where.dictionary !== 'string') return super.findOne(entity, where, options)
    const [row] = await this.find(entity, where, options)
    return row ?? null
  }
}

describe('seedUnavailabilityReasons', () => {
  it('seeds the default reasons once, however often it runs', async () => {
    const em = new DictionaryEm()
    await seedUnavailabilityReasons(em as never, scope)
    await seedUnavailabilityReasons(em as never, scope)
    expect(em.rows(Dictionary)).toHaveLength(1)
    expect(em.rows(DictionaryEntry)).toHaveLength(5)
    const reasons = await listUnavailabilityReasons(em as never, scope)
    expect(reasons.map((reason) => reason.value)).toEqual(DEFAULT_UNAVAILABILITY_REASONS.map((reason) => reason.value))
  })

  it('leaves a soft-deleted reasons dictionary alone without failing on its key', async () => {
    const em = new DictionaryEm()
    await seedUnavailabilityReasons(em as never, scope)
    const [dictionary] = em.rows(Dictionary)
    dictionary.deletedAt = new Date()
    dictionary.isActive = false

    await expect(seedUnavailabilityReasons(em as never, scope)).resolves.toBeUndefined()

    expect(em.rows(Dictionary)).toHaveLength(1)
    expect(em.rows(Dictionary)[0]).toMatchObject({ id: dictionary.id, isActive: false })
    expect(em.rows(Dictionary)[0].deletedAt).toBeInstanceOf(Date)
    expect(await listUnavailabilityReasons(em as never, scope)).toEqual([])
  })

  it('does not re-add a default reason an admin removed', async () => {
    const em = new DictionaryEm()
    await seedUnavailabilityReasons(em as never, scope)
    const removed = em.rows(DictionaryEntry).find((entry) => entry.value === 'cleaning')
    em.store.set(DictionaryEntry.name, em.rows(DictionaryEntry).filter((entry) => entry !== removed))

    await seedUnavailabilityReasons(em as never, scope)

    const reasons = await listUnavailabilityReasons(em as never, scope)
    expect(reasons.map((reason) => reason.value)).toEqual(['renovation', 'maintenance', 'private_event', 'other'])
  })
})

describe('assertReasonEntry', () => {
  it('accepts an entry of the active reasons dictionary', async () => {
    const em = new DictionaryEm()
    await seedUnavailabilityReasons(em as never, scope)
    const entry = em.rows(DictionaryEntry)[0]
    await expect(assertReasonEntry(em as never, scope, entry.id as string)).resolves.toBe(entry.id)
  })

  it('refuses an entry of an inactive reasons dictionary, which the list hides', async () => {
    const em = new DictionaryEm()
    await seedUnavailabilityReasons(em as never, scope)
    em.rows(Dictionary)[0].isActive = false
    const entry = em.rows(DictionaryEntry)[0]

    expect(await listUnavailabilityReasons(em as never, scope)).toEqual([])
    await expect(assertReasonEntry(em as never, scope, entry.id as string)).rejects.toMatchObject({
      body: expect.objectContaining({ code: 'unavailability_reason_invalid' }),
    })
  })
})
