import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'phone_calls.seed-call-encryption-maps',
  version: '0.7.1',
  messageKey: 'phone_calls.config.upgradeActions.encryptionMaps.message',
  ctaKey: 'phone_calls.config.upgradeActions.encryptionMaps.cta',
  successKey: 'phone_calls.config.upgradeActions.encryptionMaps.success',
  loadingKey: 'phone_calls.config.upgradeActions.encryptionMaps.loading',
  requiredModules: ['entities'],
  async run({ container, em, tenantId, organizationId, deferAfterCommit }) {
    const [{ default: encryptionMaps }, { invalidateEncryptionMapScopes, upsertEncryptionMapSpecs }] = await Promise.all([
      import('../encryption'),
      import('@open-mercato/core/modules/entities/lib/encryption-maps'),
    ])
    const materializedScopes = await upsertEncryptionMapSpecs(em, tenantId, organizationId ?? null, encryptionMaps)
    const invalidate = async () => {
      const encryptionService = container.resolve('tenantEncryptionService') as Parameters<typeof invalidateEncryptionMapScopes>[0]
      await invalidateEncryptionMapScopes(encryptionService, materializedScopes)
    }
    if (deferAfterCommit) deferAfterCommit(invalidate)
    else await invalidate()
  },
})
