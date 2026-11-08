import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AttachmentPartition } from '../data/entities'
import { attachmentAccessRequirementsSchema, attachmentLibraryExcludedEntitiesSchema, attachmentLibraryExcludedEntitySchema } from '../data/validators'
import { getAttachmentAccessRegistry, matchesAttachmentAccessSelector } from './access-registry'
import type { AttachmentAccessRequirement } from './access-types'

export function getDeclaredAttachmentAccessRequirements(partitionCode: string): AttachmentAccessRequirement[] {
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) throw new Error('[internal] Attachment access registry is invalid')
  return registry.protectedTargets
    .filter((target) => matchesAttachmentAccessSelector(target.targetPartition, partitionCode))
    .map(({ resolverId, targetEntity }) => ({ resolverId, targetEntity }))
}

/** Owner entity ids that registered targets matching this partition keep out of the shared library. */
export function getDeclaredLibraryExcludedEntities(partitionCode: string): string[] {
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) throw new Error('[internal] Attachment access registry is invalid')
  return uniqueEntities(registry.protectedTargets
    .filter((target) => target.listInLibrary === false && matchesAttachmentAccessSelector(target.targetPartition, partitionCode))
    .map((target) => target.targetEntity))
}

/** A new partition's `library_excluded_entities`: the declared exclusions, or `null` when there are none. */
export function getInitialLibraryExcludedEntities(partitionCode: string): string[] | null {
  const excluded = getDeclaredLibraryExcludedEntities(partitionCode)
  return excluded.length ? excluded : null
}

/**
 * Owner entity ids excluded from `GET /api/attachments/library`: every registered
 * `listInLibrary: false` target, plus what the given partitions carry durably. The
 * read is lenient on purpose: a malformed column value is skipped entry by entry,
 * since the library exclusion narrows a listing whose rows still pass owner access.
 */
export function resolveLibraryExcludedEntities(
  partitions: readonly Pick<AttachmentPartition, 'libraryExcludedEntities'>[],
): string[] {
  const registry = getAttachmentAccessRegistry()
  const declared = registry.invalid
    ? []
    : registry.protectedTargets.filter((target) => target.listInLibrary === false).map((target) => target.targetEntity)
  const persisted = partitions.flatMap((partition) => (
    Array.isArray(partition.libraryExcludedEntities)
      ? partition.libraryExcludedEntities.filter((entry): entry is string => attachmentLibraryExcludedEntitySchema.safeParse(entry).success)
      : []
  ))
  return uniqueEntities([...declared, ...persisted])
}

function uniqueEntities(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function mergeLibraryExcludedEntities(current: unknown, required: readonly string[]): string[] {
  const existing = attachmentLibraryExcludedEntitiesSchema.parse(current ?? [])
  return uniqueEntities([...existing, ...required])
}

function needsProtectionWrite(partition: Pick<AttachmentPartition, 'code' | 'accessResolverRequirements' | 'libraryExcludedEntities'>): boolean {
  const required = getDeclaredAttachmentAccessRequirements(partition.code)
  const excluded = getDeclaredLibraryExcludedEntities(partition.code)
  if (!required.length && !excluded.length) return false
  const existing = attachmentAccessRequirementsSchema.parse(partition.accessResolverRequirements ?? [])
  if (JSON.stringify(mergeAttachmentAccessRequirements(existing, required)) !== JSON.stringify(existing)) return true
  const existingExcluded = attachmentLibraryExcludedEntitiesSchema.parse(partition.libraryExcludedEntities ?? [])
  return JSON.stringify(mergeLibraryExcludedEntities(existingExcluded, excluded)) !== JSON.stringify(existingExcluded)
}

export function mergeAttachmentAccessRequirements(
  current: unknown,
  required: readonly AttachmentAccessRequirement[],
): AttachmentAccessRequirement[] {
  const existing = attachmentAccessRequirementsSchema.parse(current ?? [])
  const union = new Map<string, AttachmentAccessRequirement>()
  for (const requirement of [...existing, ...required]) {
    union.set(JSON.stringify([requirement.resolverId, requirement.targetEntity]), { ...requirement })
  }
  return [...union.values()]
}

export async function syncAttachmentAccessProtection(
  em: EntityManager,
  options: { partitionCode?: string } = {},
): Promise<number> {
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) throw new Error('[internal] Attachment access registry is invalid')
  if (!registry.protectedTargets.length) return 0
  const isolated = em.fork({ clear: true, useContext: false })
  const candidates = await findWithDecryption(
    isolated,
    AttachmentPartition,
    options.partitionCode ? { code: options.partitionCode } : {},
    { orderBy: { id: 'asc' } },
    { tenantId: null, organizationId: null },
  )
  if (
    options.partitionCode
    && (getDeclaredAttachmentAccessRequirements(options.partitionCode).length || getDeclaredLibraryExcludedEntities(options.partitionCode).length)
    && !candidates.length
  ) {
    throw new Error('[internal] Protected attachment partition is not durably configured')
  }
  const pending = candidates.filter(needsProtectionWrite)
  if (!pending.length) return 0
  return isolated.transactional(async (transaction) => {
    let changed = 0
    for (const candidate of pending) {
      const partition = await findOneWithDecryption(transaction, AttachmentPartition, { id: candidate.id }, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
        refresh: true,
      }, { tenantId: null, organizationId: null })
      if (!partition) throw new Error('[internal] Attachment partition disappeared during access protection synchronization')
      const existing = attachmentAccessRequirementsSchema.parse(partition.accessResolverRequirements ?? [])
      const merged = mergeAttachmentAccessRequirements(existing, getDeclaredAttachmentAccessRequirements(partition.code))
      const existingExcluded = attachmentLibraryExcludedEntitiesSchema.parse(partition.libraryExcludedEntities ?? [])
      const mergedExcluded = mergeLibraryExcludedEntities(existingExcluded, getDeclaredLibraryExcludedEntities(partition.code))
      const requirementsChanged = JSON.stringify(merged) !== JSON.stringify(existing)
      const exclusionChanged = JSON.stringify(mergedExcluded) !== JSON.stringify(existingExcluded)
      if (!requirementsChanged && !exclusionChanged) continue
      if (requirementsChanged) partition.accessResolverRequirements = merged
      if (exclusionChanged) partition.libraryExcludedEntities = mergedExcluded
      changed += 1
    }
    if (changed) await transaction.flush()
    return changed
  })
}

export async function ensureAttachmentPartitionProtection(
  em: EntityManager,
  partition: AttachmentPartition,
): Promise<void> {
  if (!needsProtectionWrite(partition)) return
  await syncAttachmentAccessProtection(em, { partitionCode: partition.code })
}
