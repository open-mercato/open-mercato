import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import seedPushTokenEncryptionMap from './upgrades/0.6.6-seed-push-token-encryption-map'

export const upgradeActions: ModuleUpgradeActions = [seedPushTokenEncryptionMap]

export default upgradeActions
