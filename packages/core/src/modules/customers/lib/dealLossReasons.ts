import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'

export const DEAL_LOSS_REASON_DICTIONARY_KEY = 'sales.deal_loss_reason'

const LEGACY_DEAL_LOSS_REASON_DICTIONARY_KEY = 'customer_lost_reason'

type DealLossReasonScope = { tenantId: string; organizationId: string }

type DealLossReasonSeed = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

export type BackfillDealLossReasonDictionaryResult = {
  dictionaryId: string
  createdDictionary: boolean
  copiedLegacyEntries: number
  seededDefaultEntries: number
  existingEntries: number
}

export const DEAL_LOSS_REASON_DEFAULTS: DealLossReasonSeed[] = [
  { value: 'lost_to_competitor', label: 'Lost to competitor', color: '#ef4444', icon: 'lucide:users' },
  { value: 'no_budget', label: 'No budget', color: '#f59e0b', icon: 'lucide:wallet' },
  { value: 'no_decision', label: 'No decision made', color: '#94a3b8', icon: 'lucide:help-circle' },
  { value: 'timing', label: 'Bad timing', color: '#6366f1', icon: 'lucide:clock' },
  { value: 'other', label: 'Other', color: '#71717a', icon: 'lucide:minus-circle' },
]

async function findDealLossReasonDictionary(
  em: EntityManager,
  scope: DealLossReasonScope,
): Promise<Dictionary | null> {
  return em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: DEAL_LOSS_REASON_DICTIONARY_KEY,
  })
}

async function ensureDealLossReasonDictionary(
  em: EntityManager,
  scope: DealLossReasonScope,
): Promise<Dictionary> {
  const existing = await findDealLossReasonDictionary(em, scope)
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null
      existing.isActive = true
      existing.updatedAt = new Date()
      em.persist(existing)
      await em.flush()
    }
    return existing
  }
  const now = new Date()
  const dictionary = em.create(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: DEAL_LOSS_REASON_DICTIONARY_KEY,
    name: 'Deal loss reasons',
    description: 'Reusable reasons used when closing deals as lost.',
    isSystem: true,
    isActive: true,
    managerVisibility: 'hidden',
    createdAt: now,
    updatedAt: now,
  })
  em.persist(dictionary)
  await em.flush()
  return dictionary
}

async function ensureDealLossReasonEntry(
  em: EntityManager,
  scope: DealLossReasonScope,
  dictionary: Dictionary,
  seed: DealLossReasonSeed,
): Promise<DictionaryEntry | null> {
  const value = seed.value?.trim()
  if (!value) return null
  const normalizedValue = normalizeDictionaryValue(value)
  const color = seed.color === undefined ? undefined : sanitizeDictionaryColor(seed.color)
  const icon = seed.icon === undefined ? undefined : sanitizeDictionaryIcon(seed.icon)
  const existing = await em.findOne(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    normalizedValue,
  })
  if (existing) {
    let changed = false
    if (color !== undefined && existing.color !== color) {
      existing.color = color ?? null
      changed = true
    }
    if (icon !== undefined && existing.icon !== icon) {
      existing.icon = icon ?? null
      changed = true
    }
    if (changed) {
      existing.updatedAt = new Date()
      em.persist(existing)
    }
    return existing
  }
  const now = new Date()
  const entry = em.create(DictionaryEntry, {
    dictionary,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    value,
    label: seed.label?.trim() || value,
    normalizedValue,
    color: color ?? null,
    icon: icon ?? null,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(entry)
  return entry
}

export async function seedDealLossReasons(
  em: EntityManager,
  scope: DealLossReasonScope,
): Promise<void> {
  const dictionary = await ensureDealLossReasonDictionary(em, scope)
  for (const seed of DEAL_LOSS_REASON_DEFAULTS) {
    await ensureDealLossReasonEntry(em, scope, dictionary, seed)
  }
  await em.flush()
}

export async function backfillDealLossReasonDictionary(
  em: EntityManager,
  scope: DealLossReasonScope,
): Promise<BackfillDealLossReasonDictionaryResult> {
  const storedDictionary = await findDealLossReasonDictionary(em, scope)
  const existingDictionary = storedDictionary && !storedDictionary.deletedAt ? storedDictionary : null
  const dictionary = await ensureDealLossReasonDictionary(em, scope)
  const targetEntries = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  if (targetEntries.length > 0) {
    return {
      dictionaryId: dictionary.id,
      createdDictionary: !existingDictionary,
      copiedLegacyEntries: 0,
      seededDefaultEntries: 0,
      existingEntries: targetEntries.length,
    }
  }

  const legacyDictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: LEGACY_DEAL_LOSS_REASON_DICTIONARY_KEY,
    deletedAt: null,
  })
  const legacyEntries = legacyDictionary
    ? await em.find(
      DictionaryEntry,
      {
        dictionary: legacyDictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { orderBy: { position: 'asc', label: 'asc' } },
    )
    : []

  let copiedLegacyEntries = 0
  let seededDefaultEntries = 0
  const processedValues = new Set<string>()
  const seeds: DealLossReasonSeed[] = legacyEntries.length
    ? legacyEntries.map((entry) => ({
      value: entry.value,
      label: entry.label,
      color: entry.color,
      icon: entry.icon,
    }))
    : DEAL_LOSS_REASON_DEFAULTS

  for (const seed of seeds) {
    const normalizedValue = normalizeDictionaryValue(seed.value ?? '')
    if (!normalizedValue || processedValues.has(normalizedValue)) continue
    const entry = await ensureDealLossReasonEntry(em, scope, dictionary, seed)
    if (!entry) continue
    processedValues.add(normalizedValue)
    if (legacyEntries.length) copiedLegacyEntries += 1
    else seededDefaultEntries += 1
  }

  return {
    dictionaryId: dictionary.id,
    createdDictionary: !existingDictionary,
    copiedLegacyEntries,
    seededDefaultEntries,
    existingEntries: 0,
  }
}
