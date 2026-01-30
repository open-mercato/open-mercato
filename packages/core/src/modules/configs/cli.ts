import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from './lib/module-config-service'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { DEFAULT_NOTIFICATION_DELIVERY_CONFIG, NOTIFICATIONS_DELIVERY_CONFIG_KEY } from '../notifications/lib/deliveryConfig'

function envDisablesAutoIndexing(): boolean {
  const raw = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  return parseBooleanToken(raw) === true
}

const restoreDefaults: ModuleCli = {
  command: 'restore-defaults',
  async run() {
    const container = await createRequestContainer()
    try {
      let service: ModuleConfigService
      try {
        service = (container.resolve('moduleConfigService') as ModuleConfigService)
      } catch {
        console.error('[configs] moduleConfigService is not registered in the container.')
        return
      }

      const disabledByEnv = envDisablesAutoIndexing()
      const defaultEnabled = !disabledByEnv
      await service.restoreDefaults(
        [
          {
            moduleId: 'vector',
            name: 'auto_index_enabled',
            value: defaultEnabled,
          },
          {
            moduleId: 'notifications',
            name: NOTIFICATIONS_DELIVERY_CONFIG_KEY,
            value: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
          },
        ],
        { force: true },
      )
      console.log(
        `[configs] Vector auto-indexing default set to ${defaultEnabled ? 'enabled' : 'disabled'}${
          disabledByEnv ? ' (forced by DISABLE_VECTOR_SEARCH_AUTOINDEXING)' : ''
        }.`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      if (typeof disposable.dispose === 'function') {
        await disposable.dispose()
      }
    }
  },
}

const help: ModuleCli = {
  command: 'help',
  async run() {
    console.log('Usage: yarn mercato configs restore-defaults')
    console.log('  Ensures global module configuration defaults exist.')
  },
}

export default [restoreDefaults, help]
