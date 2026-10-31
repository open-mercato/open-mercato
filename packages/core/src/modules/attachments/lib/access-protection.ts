import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AttachmentPartition } from '../data/entities'
import { attachmentAccessRequirementsSchema } from '../data/validators'
import { getAttachmentAccessRegistry, matchesAttachmentAccessSelector } from './access-registry'
import type { AttachmentAccessRequirement } from './access-types'

export function getDeclaredAttachmentAccessRequirements(partitionCode: string): AttachmentAccessRequirement[] {
  const registry = getAttachmentAccessRegistry()
  if (registry.invalid) throw new Error('[internal] Attachment access registry is invalid')
  return registry.protectedTargets
    .filter((target) => matchesAttachmentAccessSelector(target.targetPartition, partitionCode))
    .map(({ resolverId, targetEntity }) => ({ resolverId, targetEntity }))
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
  if (options.partitionCode && getDeclaredAttachmentAccessRequirements(options.partitionCode).length && !candidates.length) {
    throw new Error('[internal] Protected attachment partition is not durably configured')
  }
  const pending = candidates.filter((partition) => {
    const required = getDeclaredAttachmentAccessRequirements(partition.code)
    if (!required.length) return false
    const existing = attachmentAccessRequirementsSchema.parse(partition.accessResolverRequirements ?? [])
    return JSON.stringify(mergeAttachmentAccessRequirements(existing, required)) !== JSON.stringify(existing)
  })
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
      if (JSON.stringify(merged) === JSON.stringify(existing)) continue
      partition.accessResolverRequirements = merged
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
  const required = getDeclaredAttachmentAccessRequirements(partition.code)
  if (!required.length) return
  const existing = attachmentAccessRequirementsSchema.parse(partition.accessResolverRequirements ?? [])
  const merged = mergeAttachmentAccessRequirements(existing, required)
  if (JSON.stringify(existing) === JSON.stringify(merged)) return
  await syncAttachmentAccessProtection(em, { partitionCode: partition.code })
}
