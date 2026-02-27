import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { DEFAULT_RECORD_LOCK_SETTINGS, RECORD_LOCKS_MODULE_ID, RECORD_LOCKS_SETTINGS_NAME } from './lib/config'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em }) {
    const existing = await em.findOne(ModuleConfig, {
      moduleId: RECORD_LOCKS_MODULE_ID,
      name: RECORD_LOCKS_SETTINGS_NAME,
    })
    if (existing) {
      const current = existing.valueJson && typeof existing.valueJson === 'object'
        ? (existing.valueJson as Record<string, unknown>)
        : {}
      const currentEnabledResources = Array.isArray(current.enabledResources)
        ? current.enabledResources.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : []
      if (currentEnabledResources.length > 0) return

      existing.valueJson = {
        ...current,
        enabledResources: DEFAULT_RECORD_LOCK_SETTINGS.enabledResources,
      }
      em.persist(existing)
      await em.flush()
      return
    }

    const row = em.create(ModuleConfig, {
      moduleId: RECORD_LOCKS_MODULE_ID,
      name: RECORD_LOCKS_SETTINGS_NAME,
      valueJson: DEFAULT_RECORD_LOCK_SETTINGS,
    })
    em.persist(row)
    await em.flush()
  },
  defaultRoleFeatures: {
    superadmin: ['record_locks.*'],
    admin: ['record_locks.*'],
    employee: ['record_locks.view'],
  },
}

export default setup
