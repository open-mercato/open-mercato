import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import registerSessionInitializationPrune from './upgrades/0.6.6-register-session-initialization-prune'

export const upgradeActions: ModuleUpgradeActions = [registerSessionInitializationPrune]

export default upgradeActions
