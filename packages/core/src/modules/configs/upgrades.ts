import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import testReversibleFixture from './upgrades/0.0.1-test-reversible-fixture'
import testScheduleRollbackFixture from './upgrades/0.0.1-test-schedule-rollback-fixture'

function isEnabled(flag: string | undefined): boolean {
  return parseBooleanToken(flag ?? '') === true
}

export const upgradeActions: ModuleUpgradeActions = [
  ...(isEnabled(process.env.OM_UPGRADE_ACTION_TEST_FIXTURES) ? [testReversibleFixture] : []),
  ...(isEnabled(process.env.OM_UPGRADE_ACTION_ROLLBACK_FIXTURE) ? [testScheduleRollbackFixture] : []),
]

export default upgradeActions
