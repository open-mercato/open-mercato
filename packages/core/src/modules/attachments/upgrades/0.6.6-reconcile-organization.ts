import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('attachments').child({ component: 'upgrade-actions' })

export default defineUpgradeAction({
  id: 'attachments.reconcile-organization',
  version: '0.6.6',
  messageKey: 'configs.upgrades.attachmentsOrgReconcile.message',
  ctaKey: 'configs.upgrades.attachmentsOrgReconcile.cta',
  successKey: 'configs.upgrades.attachmentsOrgReconcile.success',
  loadingKey: 'configs.upgrades.attachmentsOrgReconcile.loading',
  scope: 'tenant',
  async run({ container, em, tenantId }) {
    const { reconcileAttachmentOrganizations } = await import('../lib/reconcileOrganization')
    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const report = await reconcileAttachmentOrganizations({ em, queryEngine, tenantId })
    logger.info('attachments organization reconcile completed', {
      tenantId,
      scanned: report.scanned,
      updated: report.updated,
      unresolved: report.unresolved,
      skippedVirtual: report.skippedVirtual,
    })
  },
})
