import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import registerCodeReservationSweepSchedule from './upgrades/0.9.1-register-code-reservation-sweep-schedule'

export const upgradeActions: ModuleUpgradeActions = [registerCodeReservationSweepSchedule]

export default upgradeActions
