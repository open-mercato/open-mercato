import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry, type DictionaryManagerVisibility } from '@open-mercato/core/modules/dictionaries/data/entities'
import { BOOKING_CAPACITY_UNIT_DEFAULTS, BOOKING_CAPACITY_UNIT_DICTIONARY_KEY } from './capacityUnits'

export type BookingSeedScope = { tenantId: string; organizationId: string }

export async function seedBookingCapacityUnits(
  em: EntityManager,
  scope: BookingSeedScope,
) {
  let dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: BOOKING_CAPACITY_UNIT_DICTIONARY_KEY,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      key: BOOKING_CAPACITY_UNIT_DICTIONARY_KEY,
      name: 'Booking capacity units',
      description: 'Units for booking resource capacity (spots, units, quantity, etc.).',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isSystem: true,
      isActive: true,
      managerVisibility: 'default' satisfies DictionaryManagerVisibility,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }

  const existingEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const existingMap = new Map(existingEntries.map((entry) => [entry.normalizedValue, entry]))
  for (const unit of BOOKING_CAPACITY_UNIT_DEFAULTS) {
    const normalized = unit.value.trim().toLowerCase()
    if (!normalized || existingMap.has(normalized)) continue
    const entry = em.create(DictionaryEntry, {
      dictionary,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      value: unit.value,
      normalizedValue: normalized,
      label: unit.label,
      color: null,
      icon: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(entry)
  }
  await em.flush()
}
