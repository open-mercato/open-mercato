import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import registerSweeperSchedules from './upgrades/0.9.1-register-sweeper-schedules'

export const upgradeActions: ModuleUpgradeActions = [registerSweeperSchedules]

export default upgradeActions
