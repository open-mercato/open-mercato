import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import reconcileOrganization from './upgrades/0.6.6-reconcile-organization'

export const upgradeActions: ModuleUpgradeActions = [reconcileOrganization]

export default upgradeActions
