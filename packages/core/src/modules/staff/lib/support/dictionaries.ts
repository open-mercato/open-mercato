import type { EntityManager } from '@mikro-orm/postgresql'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { normalizeDictionaryValue } from '@open-mercato/core/modules/dictionaries/lib/utils'

export const SUPPORT_TICKET_CATEGORY_DICTIONARY_KEY = 'staff.support_ticket_category'

type SupportScope = {
  tenantId: string
  organizationId: string
}

export type SupportTicketCategoryOption = {
  value: string
  label: string
}

type CategorySeed = {
  value: string
  label: string
  color: string
  icon: string
}

const CATEGORY_DEFAULTS: CategorySeed[] = [
  { value: 'general-question', label: 'General question', color: '#6366f1', icon: 'lucide:message-circle-question' },
  { value: 'technical-issue', label: 'Technical issue', color: '#ef4444', icon: 'lucide:bug' },
  { value: 'change-request', label: 'Change request', color: '#0d9488', icon: 'lucide:git-pull-request' },
  { value: 'billing', label: 'Billing', color: '#f59e0b', icon: 'lucide:receipt' },
]

export async function findSupportCategoryDictionary(
  em: EntityManager,
  scope: SupportScope,
): Promise<Dictionary | null> {
  return em.findOne(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: SUPPORT_TICKET_CATEGORY_DICTIONARY_KEY,
    deletedAt: null,
  })
}

export async function loadSupportTicketCategories(
  em: EntityManager,
  scope: SupportScope,
): Promise<SupportTicketCategoryOption[]> {
  const dictionary = await findSupportCategoryDictionary(em, scope)
  if (!dictionary || !dictionary.isActive) return []
  const entries = await em.find(
    DictionaryEntry,
    { dictionary, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { position: 'asc', label: 'asc' } },
  )
  return entries.map((entry) => ({ value: entry.value, label: entry.label }))
}

export async function findSupportTicketCategory(
  em: EntityManager,
  scope: SupportScope,
  value: string,
): Promise<SupportTicketCategoryOption | null> {
  const categories = await loadSupportTicketCategories(em, scope)
  return categories.find((category) => category.value === value) ?? null
}

async function ensureSupportCategoryDictionary(em: EntityManager, scope: SupportScope): Promise<Dictionary> {
  const existing = await findSupportCategoryDictionary(em, scope)
  if (existing) return existing
  const now = new Date()
  const dictionary = em.create(Dictionary, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    key: SUPPORT_TICKET_CATEGORY_DICTIONARY_KEY,
    name: 'Support ticket categories',
    description: 'Categories customers pick when they file a support ticket in the portal.',
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

export async function seedSupportTicketCategories(em: EntityManager, scope: SupportScope): Promise<void> {
  const dictionary = await ensureSupportCategoryDictionary(em, scope)
  const existing = await em.find(DictionaryEntry, {
    dictionary,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  const known = new Set(existing.map((entry) => entry.normalizedValue))
  const now = new Date()
  CATEGORY_DEFAULTS.forEach((seed, index) => {
    const normalizedValue = normalizeDictionaryValue(seed.value)
    if (known.has(normalizedValue)) return
    em.persist(
      em.create(DictionaryEntry, {
        dictionary,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        value: seed.value,
        normalizedValue,
        label: seed.label,
        color: seed.color,
        icon: seed.icon,
        position: index,
        createdAt: now,
        updatedAt: now,
      }),
    )
  })
  await em.flush()
}
