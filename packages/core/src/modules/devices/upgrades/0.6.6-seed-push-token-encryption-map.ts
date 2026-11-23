import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'

export default defineUpgradeAction({
  id: 'devices.seed-push-token-encryption-map',
  version: '0.6.6',
  messageKey: 'configs.upgrades.devicesPushTokenEncryption.message',
  ctaKey: 'configs.upgrades.devicesPushTokenEncryption.cta',
  successKey: 'configs.upgrades.devicesPushTokenEncryption.success',
  loadingKey: 'configs.upgrades.devicesPushTokenEncryption.loading',
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
