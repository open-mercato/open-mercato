import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { unprocessableError } from './errors'
import type { Scope } from './productUse'

export const UNAVAILABILITY_REASONS_DICTIONARY_KEY = 'property_management.unavailability-reasons'

export const DEFAULT_UNAVAILABILITY_REASONS = [
  { value: 'renovation', label: 'Renovation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'private_event', label: 'Private event' },
  { value: 'other', label: 'Other' },
] as const

export type UnavailabilityReason = { id: string; value: string; label: string }

async function findReasonsDictionary(em: EntityManager, scope: Scope): Promise<Dictionary | null> {
  return findOneWithDecryption(em, Dictionary, { ...scope, key: UNAVAILABILITY_REASONS_DICTIONARY_KEY, deletedAt: null }, undefined, scope)
}

export async function seedUnavailabilityReasons(em: EntityManager, scope: Scope): Promise<void> {
  const existing = await findOneWithDecryption(em, Dictionary, { ...scope, key: UNAVAILABILITY_REASONS_DICTIONARY_KEY }, undefined, scope)
  if (existing) return
  const dictionary = em.create(Dictionary, {
    ...scope,
    key: UNAVAILABILITY_REASONS_DICTIONARY_KEY,
    name: 'Unavailability reasons',
    description: 'Why a building, floor, space or unit is made unavailable.',
    isSystem: true,
    isActive: true,
    managerVisibility: 'default',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(dictionary)
  DEFAULT_UNAVAILABILITY_REASONS.forEach((reason, position) => {
    em.persist(
      em.create(DictionaryEntry, {
        ...scope,
        dictionary,
        value: reason.value,
        normalizedValue: reason.value,
        label: reason.label,
        position,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
  })
  await em.flush()
}

export async function listUnavailabilityReasons(em: EntityManager, scope: Scope): Promise<UnavailabilityReason[]> {
  const dictionary = await findReasonsDictionary(em, scope)
  if (!dictionary || !dictionary.isActive) return []
  const entries = await findWithDecryption(
    em,
    DictionaryEntry,
    { ...scope, dictionary: dictionary.id },
    { orderBy: { position: 'asc' } },
    scope,
  )
  return entries.map((entry) => ({ id: entry.id, value: entry.value, label: entry.label }))
}

export async function loadReasonLabels(em: EntityManager, scope: Scope, entryIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(entryIds.filter(Boolean)))
  if (!ids.length) return new Map()
  const entries = await findWithDecryption(em, DictionaryEntry, { ...scope, id: { $in: ids } }, undefined, scope)
  return new Map(entries.map((entry) => [entry.id, entry.label]))
}

export async function assertReasonEntry(em: EntityManager, scope: Scope, entryId: string | null | undefined): Promise<string | null> {
  if (!entryId) return null
  const dictionary = await findReasonsDictionary(em, scope)
  const entry = dictionary?.isActive
    ? await findOneWithDecryption(em, DictionaryEntry, { ...scope, id: entryId, dictionary: dictionary.id }, undefined, scope)
    : null
  if (!entry) {
    throw await unprocessableError('property_management.errors.unavailabilityReasonInvalid', 'Choose a reason from the list.', {
      code: 'unavailability_reason_invalid',
      fieldErrors: { reasonEntryId: 'property_management.errors.unavailabilityReasonInvalid' },
    })
  }
  return entry.id
}
