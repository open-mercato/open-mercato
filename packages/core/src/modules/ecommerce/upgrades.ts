import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import seedDraftStore from './upgrades/0.9.1-seed-draft-store'

export const upgradeActions: ModuleUpgradeActions = [seedDraftStore]

export default upgradeActions
