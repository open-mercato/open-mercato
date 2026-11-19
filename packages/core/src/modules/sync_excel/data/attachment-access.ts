import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type {
  AttachmentAccessInput,
  AttachmentAccessResolver,
  ProtectedAttachmentTarget,
} from '@open-mercato/core/modules/attachments'
import { SyncExcelUpload } from '../data/entities'

const uploadIdSchema = z.string().uuid()
const resolverId = 'sync_excel.upload-attachments'
const partitionCode = 'privateAttachments'
const uploadEntityId = 'sync_excel:upload'

async function canViewUpload(input: AttachmentAccessInput, uploadId: string): Promise<boolean> {
  const { subject, container, cache, signal } = input
  const { tenantId, organizationId } = subject
  if (!tenantId || !organizationId || signal.aborted) return false
  if (!authorizeFeatures(['sync_excel.view'], {
    grantedFeatures: subject.userFeatures,
    unrestricted: subject.isSuperAdmin,
  })) return false
  const cacheKey = JSON.stringify(['sync_excel_upload', tenantId, organizationId, uploadId])
  const cached = cache.get(cacheKey) as Promise<boolean> | undefined
  if (cached) return cached
  const pending = (async () => {
    const em = container.resolve<EntityManager>('em')
    const upload = await findOneWithDecryption(
      em,
      SyncExcelUpload,
      { id: uploadId, organizationId, tenantId },
      undefined,
      { tenantId, organizationId },
    )
    return upload != null
  })()
  cache.set(cacheKey, pending)
  return pending
}

export const attachmentAccessResolvers: AttachmentAccessResolver[] = [{
  id: resolverId,
  targetPartition: partitionCode,
  targetEntity: uploadEntityId,
  async resolve(input) {
    const targets = input.targets.filter((target) => target.entityId === uploadEntityId)
    if (targets.some((target) => !uploadIdSchema.safeParse(target.recordId).success)) {
      return { ok: false, status: 404, reason: 'sync_excel_upload_not_found' }
    }
    for (const target of targets) {
      if (!(await canViewUpload(input, target.recordId))) {
        return { ok: false, status: 404, reason: 'sync_excel_upload_not_found' }
      }
    }
    return { ok: true }
  },
}]

export const protectedAttachmentTargets: ProtectedAttachmentTarget[] = [{
  resolverId,
  targetPartition: partitionCode,
  targetEntity: uploadEntityId,
}]
