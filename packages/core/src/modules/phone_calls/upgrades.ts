import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import seedCallEncryptionMaps from './upgrades/0.7.1-seed-call-encryption-maps'

export const upgradeActions: ModuleUpgradeActions = [seedCallEncryptionMaps]

export default upgradeActions
