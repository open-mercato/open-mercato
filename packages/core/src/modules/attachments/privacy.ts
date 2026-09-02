import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  PrivacyDataClassHandler,
  PrivacyEnvironmentSanitizationInput,
} from '@open-mercato/shared/lib/privacy'
import { registerPrivacyDataClass, registerTenantExportExclusions } from '@open-mercato/shared/lib/privacy'
import { Attachment } from './data/entities'
import type { StorageDriverFactory } from './lib/drivers'

export const ATTACHMENTS_FILES_DATA_CLASS_ID = 'attachments.files'

registerPrivacyDataClass({
  id: ATTACHMENTS_FILES_DATA_CLASS_ID,
  module: 'attachments',
  title: 'Attachment files',
  description: 'Tenant-scoped attachment metadata, extracted content, and stored objects.',
  handlerService: 'attachmentEnvironmentPrivacyHandler',
  subjectKinds: [],
  subjectActions: [],
  environmentSanitization: { categories: ['attachments', 'personal_data'] },
})

registerTenantExportExclusions({ module: 'attachments', tables: ['attachment_quota_reservations'] })

export class AttachmentEnvironmentPrivacyHandler implements PrivacyDataClassHandler {
  constructor(
    private readonly em: EntityManager,
    private readonly storageDriverFactory: StorageDriverFactory,
  ) {}

  async sanitizeEnvironment(input: PrivacyEnvironmentSanitizationInput) {
    const attachments = await this.findAttachments(input)
    if (input.dryRun || attachments.length === 0) {
      return { matched: attachments.length, affected: 0 }
    }

    for (const attachment of attachments) {
      const driver = await this.storageDriverFactory.resolveForPartition(attachment.partitionCode, input.scope)
      if (driver.deleteStrict) {
        await driver.deleteStrict(attachment.partitionCode, attachment.storagePath)
      } else {
        await driver.delete(attachment.partitionCode, attachment.storagePath)
      }
    }
    this.em.remove(attachments)
    await this.em.flush()
    return { matched: attachments.length, affected: attachments.length }
  }

  async verifyEnvironmentSanitization(input: PrivacyEnvironmentSanitizationInput) {
    const attachments = await this.em.count(Attachment, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
    const findings = attachments > 0
      ? [{ code: 'attachments.scoped_files_present', count: attachments }]
      : []
    return { passed: findings.length === 0, findings }
  }

  private findAttachments(input: PrivacyEnvironmentSanitizationInput): Promise<Attachment[]> {
    return this.em.find(Attachment, {
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
    })
  }
}
