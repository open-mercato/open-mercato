import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureInboxSettings } from './lib/ensure-settings'
import { ensureInboundAttachmentMaintenanceScheduleSafely } from './lib/inboundAttachmentSchedule'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['inbox_ops.*'],
    admin: [
      'inbox_ops.proposals.view',
      'inbox_ops.proposals.manage',
      'inbox_ops.settings.manage',
      'inbox_ops.log.view',
      'inbox_ops.replies.send',
    ],
    employee: [
      'inbox_ops.proposals.view',
      'inbox_ops.proposals.manage',
      'inbox_ops.replies.send',
    ],
  },

  async onTenantCreated({ em, tenantId, organizationId }) {
    await ensureInboxSettings(em, { tenantId, organizationId })
  },

  async seedDefaults({ container }) {
    await ensureInboundAttachmentMaintenanceScheduleSafely(container)
  },
}

export default setup
