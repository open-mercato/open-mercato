import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { InboxSettings } from './data/entities'

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
    const exists = await findOneWithDecryption(
      em,
      InboxSettings,
      { tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (!exists) {
      const domain = process.env.INBOX_OPS_DOMAIN || 'inbox.mercato.local'
      const slug = organizationId.slice(0, 8)
      const inboxAddress = `ops-${slug}@${domain}`
      em.persist(em.create(InboxSettings, {
        tenantId,
        organizationId,
        inboxAddress,
        isActive: true,
      }))
    }
    await em.flush()
  },

  async seedDefaults() {},
}

export default setup
