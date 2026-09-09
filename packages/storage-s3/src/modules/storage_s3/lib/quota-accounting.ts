import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { isS3KeyScopedToTenant } from './key-scope'
import type { S3StorageDriver } from './s3-driver'

export async function reconcileTenantS3Objects(input: {
  driver: S3StorageDriver
  quotaService: AttachmentQuotaService
  tenantId: string
  organizationId: string
}): Promise<void> {
  const objects: Array<{ path: string; bytes: number }> = []
  let continuationToken: string | undefined
  do {
    const page = await input.driver.listObjects('', 1000, continuationToken)
    for (const file of page.files) {
      if (isS3KeyScopedToTenant(file.key, input.organizationId, input.tenantId)) {
        objects.push({ path: file.key, bytes: file.size })
      }
    }
    continuationToken = page.truncated ? page.nextContinuationToken : undefined
  } while (continuationToken)

  await input.quotaService.reconcileStandaloneObjects({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    storageDriver: 's3',
    objects,
  })
}
