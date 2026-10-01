import { ensureAttachmentPartitionProtection } from './access-protection'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AttachmentPartition, type Attachment } from '../data/entities'
import { attachmentAccessRequirementsSchema } from '../data/validators'
import { getAttachmentAccessRegistry } from './access-registry'
import { evaluateAttachmentAccess, type AttachmentAccessContext } from './access-runner'
import type { AttachmentAccessAction, AttachmentAccessRecord } from './access-types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { attachmentAccessErrorBody, throwAttachmentAccessError } from './access-errors'
import { readAttachmentMetadata } from './metadata'

export function requiresAttachmentAccessScan(partitions: readonly AttachmentPartition[]): boolean {
  const registry = getAttachmentAccessRegistry()
  return registry.invalid || registry.resolvers.length > 0 || registry.protectedTargets.length > 0
    || partitions.some((partition) => {
      const parsed = attachmentAccessRequirementsSchema.safeParse(partition.accessResolverRequirements ?? [])
      return !parsed.success || parsed.data.length > 0
    })
}

export async function assertAttachmentOwnerAccess(input: {
  em: EntityManager
  context: AttachmentAccessContext
  auth: NonNullable<AuthContext>
  attachment: AttachmentAccessRecord
  action: AttachmentAccessAction
  persistProtection?: boolean
}): Promise<void> {
  const partition = await findOneWithDecryption(input.em, AttachmentPartition, { code: input.attachment.partitionCode }, undefined, {
    tenantId: input.attachment.tenantId, organizationId: input.attachment.organizationId,
  })
  if (!partition) await throwAttachmentAccessError(404)
  if (input.persistProtection) await ensureAttachmentPartitionProtection(input.em, partition!)
  const result = await evaluateAttachmentAccess({ ...input, partition: partition!, requireAuthForPublic: true })
  if (!result.ok) await throwAttachmentAccessError(result.status)
}

export async function scanAuthorizedAttachments(input: {
  auth: NonNullable<AuthContext>
  context: AttachmentAccessContext
  partitions: readonly AttachmentPartition[]
  loadBatch(offset: number, limit: number): Promise<Attachment[]>
  offset?: number
  limit?: number
  collectTags?: boolean
  deadline?: number
}): Promise<{ records: Attachment[]; total: number; tags: string[] }> {
  const deadline = input.deadline ?? Date.now() + 15_000
  const timeoutBody = await attachmentAccessErrorBody(504)
  let timer: ReturnType<typeof setTimeout> | undefined
  const scan = async () => {
    const partitions = new Map(input.partitions.map((partition) => [partition.code, partition]))
    const records: Attachment[] = []
    const tags = new Set<string>()
    let total = 0
    for (let batchOffset = 0; ; batchOffset += 100) {
      if (Date.now() >= deadline) await throwAttachmentAccessError(504)
      const batch = await input.loadBatch(batchOffset, 100)
      for (const attachment of batch) {
        if (Date.now() >= deadline) await throwAttachmentAccessError(504)
        const partition = partitions.get(attachment.partitionCode)
        if (!partition) continue
        const access = await evaluateAttachmentAccess({
          auth: input.auth, attachment, partition, action: 'metadata', context: input.context,
          requireAuthForPublic: true,
        })
        if (Date.now() >= deadline || (!access.ok && access.status === 504)) await throwAttachmentAccessError(504)
        if (!access.ok) continue
        if (input.collectTags) for (const tag of readAttachmentMetadata(attachment.storageMetadata).tags ?? []) tags.add(tag)
        if (total >= (input.offset ?? 0) && (input.limit === undefined || records.length < input.limit)) records.push(attachment)
        total += 1
      }
      if (batch.length < 100) break
    }
    return { records, total, tags: [...tags].sort() }
  }
  try {
    return await Promise.race([scan(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CrudHttpError(504, timeoutBody)), Math.max(1, deadline - Date.now()))
    })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
