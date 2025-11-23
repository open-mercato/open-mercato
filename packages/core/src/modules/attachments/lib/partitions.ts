import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentPartition } from '../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

export type AttachmentPartitionSeed = {
  code: string
  title: string
  description?: string | null
  isPublic?: boolean
}

export const DEFAULT_ATTACHMENT_PARTITIONS: AttachmentPartitionSeed[] = [
  {
    code: 'productsMedia',
    title: 'Products media',
    description: 'Public media uploaded for catalog products.',
    isPublic: true,
  },
  {
    code: 'privateAttachments',
    title: 'Private attachments',
    description: 'Internal attachments scoped to tenants and organizations.',
    isPublic: false,
  },
]

const PRODUCT_MEDIA_ENTITY_IDS = new Set<string>([
  E.catalog.catalog_product,
])

const FALLBACK_PARTITION = 'privateAttachments'

export function resolveDefaultPartitionCode(entityId: string | null | undefined): string {
  if (!entityId) return FALLBACK_PARTITION
  if (PRODUCT_MEDIA_ENTITY_IDS.has(entityId)) return 'productsMedia'
  return FALLBACK_PARTITION
}

export async function ensureDefaultPartitions(em: EntityManager): Promise<void> {
  const repo = em.getRepository(AttachmentPartition)
  const existing = await repo.findAll({ fields: ['code'] })
  const existingCodes = new Set(existing.map((entry) => entry.code))
  const pending = DEFAULT_ATTACHMENT_PARTITIONS.filter((seed) => !existingCodes.has(seed.code))
  if (!pending.length) return
  for (const seed of pending) {
    const record = repo.create({
      code: seed.code,
      title: seed.title,
      description: seed.description ?? null,
      storageDriver: 'local',
      isPublic: seed.isPublic ?? false,
    })
    em.persist(record)
  }
  await em.flush()
}

export function sanitizePartitionCode(input: string): string {
  const trimmed = input.trim()
  const normalized = trimmed.replace(/[^a-zA-Z0-9_-]/g, '')
  return normalized
}

export function isPartitionSettingsLocked(): boolean {
  const demoModeEnabled = process.env.DEMO_MODE !== 'false'
  const onboardingEnabled = process.env.SELF_SERVICE_ONBOARDING_ENABLED === 'true'
  return demoModeEnabled || onboardingEnabled
}
