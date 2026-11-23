import type { ModuleUpgradeActions } from '@open-mercato/shared/modules/upgrade-actions'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import testReversibleFixture from './upgrades/0.0.1-test-reversible-fixture'

export const upgradeActions: ModuleUpgradeActions =
  parseBooleanToken(process.env.OM_UPGRADE_ACTION_TEST_FIXTURES ?? '') === true ? [testReversibleFixture] : []

export default upgradeActions
