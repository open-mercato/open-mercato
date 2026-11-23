import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import seedDealLossReasons from './upgrades/0.10.0-seed-deal-loss-reasons'
import seedInteractionStatuses from './upgrades/0.6.5-seed-interaction-statuses'

export const upgradeActions: ModuleUpgradeActions = [seedDealLossReasons, seedInteractionStatuses]

export default upgradeActions
