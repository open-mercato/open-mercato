import type { Module } from '@open-mercato/shared/modules/registry'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import attachments from '@open-mercato/core/modules/attachments/upgrades'
import cart from '@open-mercato/core/modules/cart/upgrades'
import customers from '@open-mercato/core/modules/customers/upgrades'
import devices from '@open-mercato/core/modules/devices/upgrades'
import ecommerce from '@open-mercato/core/modules/ecommerce/upgrades'
import paymentGateways from '@open-mercato/core/modules/payment_gateways/upgrades'
import phoneCalls from '@open-mercato/core/modules/phone_calls/upgrades'
import promotions from '@open-mercato/core/modules/promotions/upgrades'

export const SHIPPED_UPGRADE_ACTION_MODULES: Module[] = [
  { id: 'configs' },
  { id: 'entities' },
  { id: 'attachments', upgradeActions: attachments },
  { id: 'cart', upgradeActions: cart },
  { id: 'customers', upgradeActions: customers },
  { id: 'devices', upgradeActions: devices },
  { id: 'ecommerce', upgradeActions: ecommerce },
  { id: 'payment_gateways', upgradeActions: paymentGateways },
  { id: 'phone_calls', upgradeActions: phoneCalls },
  { id: 'promotions', upgradeActions: promotions },
]

/** Registers every shipped upgrade manifest the way server/CLI bootstrap does. */
export function registerShippedUpgradeActionModules(): void {
  registerModules(SHIPPED_UPGRADE_ACTION_MODULES)
}
