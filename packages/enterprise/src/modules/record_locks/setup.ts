import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { InstanceConfigInitializer } from '@open-mercato/core/modules/configs/lib/instance-config-initializer'
import { DEFAULT_RECORD_LOCK_SETTINGS, RECORD_LOCKS_MODULE_ID, RECORD_LOCKS_SETTINGS_NAME } from './lib/config'

export const setup: ModuleSetupConfig = {
  async onTenantCreated({ em, container, enabledModuleIds }) {
    if (enabledModuleIds && !enabledModuleIds.has('configs')) return
    const initializer = container?.resolve<InstanceConfigInitializer>('instanceConfigInitializer', { allowUnregistered: true })
    if (!initializer) return

    await initializer.initialize(em, {
      moduleId: RECORD_LOCKS_MODULE_ID,
      name: RECORD_LOCKS_SETTINGS_NAME,
      initialValue: DEFAULT_RECORD_LOCK_SETTINGS,
      merge(value) {
        const current = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        if (
          Array.isArray(current.enabledResources) &&
          current.enabledResources.some((item) => typeof item === 'string' && item.trim().length > 0)
        ) return undefined
        return { value: { ...current, enabledResources: DEFAULT_RECORD_LOCK_SETTINGS.enabledResources } }
      },
    })
  },
  defaultRoleFeatures: {
    superadmin: ['record_locks.*'],
    admin: ['record_locks.*'],
    employee: ['record_locks.view'],
  },
}

export default setup
