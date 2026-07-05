import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import {
  normalizeDictionaryValue,
  sanitizeDictionaryColor,
  sanitizeDictionaryIcon,
} from '@open-mercato/core/modules/dictionaries/lib/utils'
import type { WarrantyClaimDictionaryKind } from '../data/constants'

type WarrantyClaimDictionaryDefinition = {
  key: string
  name: string
  singular: string
  description: string
  resourceKind: string
  commandPrefix: string
}

type WarrantyClaimDictionarySeed = {
  value: string
  label: string
  color?: string | null
  icon?: string | null
}

type SeedScope = {
  tenantId: string
  organizationId: string
}

const DEFINITIONS: Record<WarrantyClaimDictionaryKind, WarrantyClaimDictionaryDefinition> = {
  'warranty-claim-fault-code': {
    key: 'warranty_claims.warranty_claim_fault_code',
    name: 'Warranty claim fault codes',
    singular: 'Warranty claim fault code',
    description: 'Configurable fault codes used on warranty claim lines.',
    resourceKind: 'warranty_claims.warranty-claim-fault-code',
    commandPrefix: 'warranty_claims.warranty-claim-fault-codes',
  },
  'warranty-claim-reason': {
    key: 'warranty_claims.warranty_claim_reason',
    name: 'Warranty claim reasons',
    singular: 'Warranty claim reason',
    description: 'Configurable reasons used when creating warranty and return claims.',
    resourceKind: 'warranty_claims.warranty-claim-reason',
    commandPrefix: 'warranty_claims.warranty-claim-reasons',
  },
  'warranty-claim-rejection-reason': {
    key: 'warranty_claims.warranty_claim_rejection_reason',
    name: 'Warranty claim rejection reasons',
    singular: 'Warranty claim rejection reason',
    description: 'Configurable reasons used when rejecting warranty and return claims.',
    resourceKind: 'warranty_claims.warranty-claim-rejection-reason',
    commandPrefix: 'warranty_claims.warranty-claim-rejection-reasons',
  },
}

const FAULT_CODE_DEFAULTS: WarrantyClaimDictionarySeed[] = [
  { value: 'defective', label: 'Defective', color: '#ef4444', icon: 'lucide:triangle-alert' },
  { value: 'damaged-in-transit', label: 'Damaged in transit', color: '#f59e0b', icon: 'lucide:truck' },
  { value: 'wrong-item', label: 'Wrong item', color: '#6366f1', icon: 'lucide:package-x' },
  { value: 'worn', label: 'Worn', color: '#94a3b8', icon: 'lucide:rotate-ccw' },
  { value: 'doa', label: 'Dead on arrival', color: '#dc2626', icon: 'lucide:zap-off' },
]

const CLAIM_REASON_DEFAULTS: WarrantyClaimDictionarySeed[] = [
  { value: 'warranty-defect', label: 'Warranty defect', color: '#ef4444', icon: 'lucide:shield-alert' },
  { value: 'customer-remorse', label: 'Customer remorse', color: '#94a3b8', icon: 'lucide:undo-2' },
  { value: 'wrong-order', label: 'Wrong order', color: '#6366f1', icon: 'lucide:list-x' },
  { value: 'core-exchange', label: 'Core exchange', color: '#0d9488', icon: 'lucide:repeat-2' },
  { value: 'vendor-recall', label: 'Vendor recall', color: '#f59e0b', icon: 'lucide:megaphone' },
]

const REJECTION_REASON_DEFAULTS: WarrantyClaimDictionarySeed[] = [
  { value: 'out-of-warranty', label: 'Out of warranty', color: '#ef4444', icon: 'lucide:calendar-x' },
  { value: 'no-proof-of-purchase', label: 'No proof of purchase', color: '#f59e0b', icon: 'lucide:receipt' },
  { value: 'physical-abuse', label: 'Physical abuse', color: '#dc2626', icon: 'lucide:hammer' },
  { value: 'not-our-product', label: 'Not our product', color: '#6366f1', icon: 'lucide:package-search' },
  { value: 'duplicate-claim', label: 'Duplicate claim', color: '#94a3b8', icon: 'lucide:copy-x' },
]

export function getWarrantyClaimDictionaryDefinition(
  kind: WarrantyClaimDictionaryKind
): WarrantyClaimDictionaryDefinition {
  return DEFINITIONS[kind]
}

export type WarrantyClaimDictionaryOption = {
  value: string
  label: string
}

export async function loadWarrantyClaimDictionaryOptions(
  em: EntityManager,
  scope: SeedScope,
  kind: WarrantyClaimDictionaryKind
): Promise<WarrantyClaimDictionaryOption[]> {
  const def = getWarrantyClaimDictionaryDefinition(kind)
  const dictionary = await em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: def.key,
    isActive: true,
    deletedAt: null,
  })
  if (!dictionary) return []
  const entries = await em.find(
    DictionaryEntry,
    { dictionary, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { position: 'asc', label: 'asc' } }
  )
  return entries.map((entry) => ({ value: entry.value, label: entry.label }))
}

export async function ensureWarrantyClaimDictionary(params: {
  em: EntityManager
  tenantId: string
  organizationId: string
  kind: WarrantyClaimDictionaryKind
}): Promise<Dictionary> {
  const { em, tenantId, organizationId, kind } = params
  const def = getWarrantyClaimDictionaryDefinition(kind)
  let dictionary = await em.findOne(Dictionary, {
    tenantId,
    organizationId,
    key: def.key,
    deletedAt: null,
  })
  if (!dictionary) {
    dictionary = em.create(Dictionary, {
      tenantId,
      organizationId,
      key: def.key,
      name: def.name,
      description: def.description,
      isSystem: true,
      isActive: true,
      managerVisibility: 'hidden',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(dictionary)
    await em.flush()
  }
  return dictionary
}

async function ensureWarrantyClaimDictionaryEntry(
  em: EntityManager,
  scope: SeedScope,
  kind: WarrantyClaimDictionaryKind,
  seed: WarrantyClaimDictionarySeed
): Promise<DictionaryEntry | null> {
  const value = seed.value?.trim()
  if (!value) return null
  const dictionary = await ensureWarrantyClaimDictionary({
    em,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    kind,
  })
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

async function seedWarrantyClaimDictionary(
  em: EntityManager,
  scope: SeedScope,
  kind: WarrantyClaimDictionaryKind,
  defaults: WarrantyClaimDictionarySeed[]
): Promise<void> {
  for (const seed of defaults) {
    await ensureWarrantyClaimDictionaryEntry(em, scope, kind, seed)
  }
}

export async function seedWarrantyClaimDictionaries(
  em: EntityManager,
  scope: SeedScope
): Promise<void> {
  await seedWarrantyClaimDictionary(em, scope, 'warranty-claim-fault-code', FAULT_CODE_DEFAULTS)
  await seedWarrantyClaimDictionary(em, scope, 'warranty-claim-reason', CLAIM_REASON_DEFAULTS)
  await seedWarrantyClaimDictionary(
    em,
    scope,
    'warranty-claim-rejection-reason',
    REJECTION_REASON_DEFAULTS
  )
}
