import { defineUpgradeAction } from '@open-mercato/shared/modules/upgrade-actions'
import { ModuleConfig } from '../data/entities'

export const TEST_FIXTURE_ACTION_ID = 'configs.test-reversible-fixture'
export const TEST_FIXTURE_CONFIG_NAME = 'upgrade_action_test_fixture'
export const TEST_FIXTURE_MARKER = 'applied-by-upgrade-action'

/**
 * Integration-test-only action with a provable inverse. It is registered only when
 * `OM_UPGRADE_ACTION_TEST_FIXTURES=1`, writes one tenant/organization-scoped
 * `module_configs` row, and `down` deletes that row only while it still holds the
 * exact value this action wrote.
 */
export default defineUpgradeAction({
  id: TEST_FIXTURE_ACTION_ID,
  version: '0.0.1',
  messageKey: 'configs.upgrades.testFixture.message',
  ctaKey: 'configs.upgrades.testFixture.cta',
  successKey: 'configs.upgrades.testFixture.success',
  async run({ em, tenantId, organizationId }) {
    const existing = await em.findOne(ModuleConfig, { moduleId: 'configs', name: TEST_FIXTURE_CONFIG_NAME, tenantId, organizationId })
    if (existing) throw new Error('[internal] Test fixture row already exists; refusing to adopt pre-existing data')
    em.persist(em.create(ModuleConfig, {
      moduleId: 'configs',
      name: TEST_FIXTURE_CONFIG_NAME,
      tenantId,
      organizationId,
      valueJson: { marker: TEST_FIXTURE_MARKER },
    }))
    await em.flush()
  },
  async down({ em, tenantId, organizationId }) {
    const row = await em.findOne(ModuleConfig, { moduleId: 'configs', name: TEST_FIXTURE_CONFIG_NAME, tenantId, organizationId })
    const value = row?.valueJson as { marker?: unknown } | null | undefined
    if (!row || value?.marker !== TEST_FIXTURE_MARKER) {
      throw new Error('[internal] Test fixture row changed since apply; refusing to revert')
    }
    em.remove(row)
    await em.flush()
  },
})
