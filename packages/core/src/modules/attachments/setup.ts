import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { syncAttachmentAccessProtection } from './lib/access-protection'
import { ensureDefaultPartitions } from './lib/partitions'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em }) {
    await ensureDefaultPartitions(em)
    await syncAttachmentAccessProtection(em)
  },
  async seedDefaults({ em }) {
    await ensureDefaultPartitions(em)
    await syncAttachmentAccessProtection(em)
  },
  defaultRoleFeatures: {
    admin: ['attachments.*', 'attachments.view', 'attachments.manage'],
    employee: ['attachments.view'],
  },
}

export default setup
