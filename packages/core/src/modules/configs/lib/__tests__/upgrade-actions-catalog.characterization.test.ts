import { actionsUpToVersion, getUpgradeActionOwner, upgradeActions } from '../upgrade-actions'
import { resolveUpgradeActionScope } from '../upgrade-action-catalog'
import { registerShippedUpgradeActionModules } from './helpers/shippedUpgradeActions'

const FROZEN_CATALOG = [
  {
    id: 'customers.seed-interaction-statuses',
    version: '0.6.5',
    messageKey: 'customers.config.upgradeActions.interactionStatuses.message',
    ctaKey: 'customers.config.upgradeActions.interactionStatuses.cta',
    successKey: 'customers.config.upgradeActions.interactionStatuses.success',
    loadingKey: 'customers.config.upgradeActions.interactionStatuses.loading',
    scope: 'organization',
    requiredModules: ['customers'],
  },
  {
    id: 'attachments.reconcile-organization',
    version: '0.6.6',
    messageKey: 'configs.upgrades.attachmentsOrgReconcile.message',
    ctaKey: 'configs.upgrades.attachmentsOrgReconcile.cta',
    successKey: 'configs.upgrades.attachmentsOrgReconcile.success',
    loadingKey: 'configs.upgrades.attachmentsOrgReconcile.loading',
    scope: 'tenant',
    requiredModules: ['attachments'],
  },
  {
    id: 'devices.seed-push-token-encryption-map',
    version: '0.6.6',
    messageKey: 'configs.upgrades.devicesPushTokenEncryption.message',
    ctaKey: 'configs.upgrades.devicesPushTokenEncryption.cta',
    successKey: 'configs.upgrades.devicesPushTokenEncryption.success',
    loadingKey: 'configs.upgrades.devicesPushTokenEncryption.loading',
    scope: 'organization',
    requiredModules: ['devices', 'entities'],
  },
  {
    id: 'payment_gateways.register-session-initialization-prune',
    version: '0.6.6',
    messageKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.message',
    ctaKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.cta',
    successKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.success',
    loadingKey: 'payment_gateways.upgradeActions.sessionInitializationPrune.loading',
    scope: 'organization',
    requiredModules: ['payment_gateways'],
  },
  {
    id: 'phone_calls.seed-call-encryption-maps',
    version: '0.7.1',
    messageKey: 'phone_calls.config.upgradeActions.encryptionMaps.message',
    ctaKey: 'phone_calls.config.upgradeActions.encryptionMaps.cta',
    successKey: 'phone_calls.config.upgradeActions.encryptionMaps.success',
    loadingKey: 'phone_calls.config.upgradeActions.encryptionMaps.loading',
    scope: 'organization',
    requiredModules: ['phone_calls', 'entities'],
  },
  {
    id: 'cart.register-sweeper-schedules',
    version: '0.9.1',
    messageKey: 'configs.upgrades.cartSweeperSchedules.message',
    ctaKey: 'configs.upgrades.cartSweeperSchedules.cta',
    successKey: 'configs.upgrades.cartSweeperSchedules.success',
    loadingKey: 'configs.upgrades.cartSweeperSchedules.loading',
    scope: 'tenant',
    requiredModules: ['cart'],
  },
  {
    id: 'ecommerce.seed-draft-store',
    version: '0.9.1',
    messageKey: 'configs.upgrades.ecommerceDraftStore.message',
    ctaKey: 'configs.upgrades.ecommerceDraftStore.cta',
    successKey: 'configs.upgrades.ecommerceDraftStore.success',
    loadingKey: 'configs.upgrades.ecommerceDraftStore.loading',
    scope: 'organization',
    requiredModules: ['ecommerce'],
  },
  {
    id: 'promotions.register-code-reservation-sweep-schedule',
    version: '0.9.1',
    messageKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.message',
    ctaKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.cta',
    successKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.success',
    loadingKey: 'configs.upgrades.promotionsCodeReservationSweepSchedule.loading',
    scope: 'tenant',
    requiredModules: ['promotions'],
  },
  {
    id: 'customers.seed-deal-loss-reasons',
    version: '0.10.0',
    messageKey: 'customers.config.upgradeActions.dealLossReasons.message',
    ctaKey: 'customers.config.upgradeActions.dealLossReasons.cta',
    successKey: 'customers.config.upgradeActions.dealLossReasons.success',
    loadingKey: 'customers.config.upgradeActions.dealLossReasons.loading',
    scope: 'organization',
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
    scope: resolveUpgradeActionScope(action),
    requiredModules: [
      ...[getUpgradeActionOwner(action)].filter((owner): owner is string => owner !== null),
      ...(action.requiredModules ?? []),
    ],
  }
}

describe('upgrade action catalog characterization', () => {
  beforeAll(() => registerShippedUpgradeActionModules())

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
