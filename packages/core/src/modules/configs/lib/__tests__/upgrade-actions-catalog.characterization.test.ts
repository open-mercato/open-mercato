import { actionsUpToVersion, upgradeActions } from '../upgrade-actions'

const FROZEN_CATALOG = [
  {
    id: 'customers.seed-interaction-statuses',
    version: '0.6.5',
    messageKey: 'customers.config.upgradeActions.interactionStatuses.message',
    ctaKey: 'customers.config.upgradeActions.interactionStatuses.cta',
    successKey: 'customers.config.upgradeActions.interactionStatuses.success',
    loadingKey: 'customers.config.upgradeActions.interactionStatuses.loading',
    requiredModules: ['customers'],
  },
  {
    id: 'attachments.reconcile-organization',
    version: '0.6.6',
    messageKey: 'configs.upgrades.attachmentsOrgReconcile.message',
    ctaKey: 'configs.upgrades.attachmentsOrgReconcile.cta',
    successKey: 'configs.upgrades.attachmentsOrgReconcile.success',
    loadingKey: 'configs.upgrades.attachmentsOrgReconcile.loading',
    requiredModules: ['attachments'],
  },
  {
    id: 'devices.seed-push-token-encryption-map',
    version: '0.6.6',
    messageKey: 'configs.upgrades.devicesPushTokenEncryption.message',
    ctaKey: 'configs.upgrades.devicesPushTokenEncryption.cta',
    successKey: 'configs.upgrades.devicesPushTokenEncryption.success',
    loadingKey: 'configs.upgrades.devicesPushTokenEncryption.loading',
    requiredModules: ['devices'],
  },
  {
    id: 'payment_gateways.register-session-initialization-prune',
    version: '0.6.6',
    messageKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.message',
    ctaKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.cta',
    successKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.success',
    loadingKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.loading',
    requiredModules: ['payment_gateways'],
  },
  {
    id: 'phone_calls.seed-call-encryption-maps',
    version: '0.7.1',
    messageKey: 'phone_calls.config.upgradeActions.encryptionMaps.message',
    ctaKey: 'phone_calls.config.upgradeActions.encryptionMaps.cta',
    successKey: 'phone_calls.config.upgradeActions.encryptionMaps.success',
    loadingKey: 'phone_calls.config.upgradeActions.encryptionMaps.loading',
    requiredModules: ['phone_calls'],
  },
  {
    id: 'cart.register-sweeper-schedules',
    version: '0.9.1',
    messageKey: 'configs.upgrades.cartSweeperSchedules.message',
    ctaKey: 'configs.upgrades.cartSweeperSchedules.cta',
    successKey: 'configs.upgrades.cartSweeperSchedules.success',
    loadingKey: 'configs.upgrades.cartSweeperSchedules.loading',
    requiredModules: ['cart'],
  },
  {
    id: 'ecommerce.seed-draft-store',
    version: '0.9.1',
    messageKey: 'configs.upgrades.ecommerceDraftStore.message',
    ctaKey: 'configs.upgrades.ecommerceDraftStore.cta',
    successKey: 'configs.upgrades.ecommerceDraftStore.success',
    loadingKey: 'configs.upgrades.ecommerceDraftStore.loading',
    requiredModules: ['ecommerce'],
  },
  {
    id: 'promotions.register-code-reservation-sweep-schedule',
    version: '0.9.1',
    messageKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.message',
    ctaKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.cta',
    successKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.success',
    loadingKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.loading',
    requiredModules: ['promotions'],
  },
  {
    id: 'customers.seed-deal-loss-reasons',
    version: '0.10.0',
    messageKey: 'customers.config.upgradeActions.dealLossReasons.message',
    ctaKey: 'customers.config.upgradeActions.dealLossReasons.cta',
    successKey: 'customers.config.upgradeActions.dealLossReasons.success',
    loadingKey: 'customers.config.upgradeActions.dealLossReasons.loading',
    requiredModules: ['customers'],
  },
]

function identityOf(action: (typeof upgradeActions)[number]) {
  return {
    id: action.id,
    version: action.version,
    messageKey: action.messageKey,
    ctaKey: action.ctaKey,
    successKey: action.successKey,
    loadingKey: action.loadingKey,
    requiredModules: action.requiredModules,
  }
}

describe('upgrade action catalog characterization', () => {
  it('keeps every shipped action identity, translation key and required module in execution order', () => {
    expect(actionsUpToVersion('99.0.0').map(identityOf)).toEqual(FROZEN_CATALOG)
  })

  it('keeps every (id, version) completion key unique', () => {
    const keys = actionsUpToVersion('99.0.0').map((action) => `${action.version}::${action.id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('caps the catalog at the requested app version', () => {
    expect(actionsUpToVersion('0.6.6').map((action) => action.id)).toEqual(
      FROZEN_CATALOG.filter((entry) => entry.version === '0.6.5' || entry.version === '0.6.6').map((entry) => entry.id),
    )
  })
})
