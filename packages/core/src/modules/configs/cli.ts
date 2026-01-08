import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from './lib/module-config-service'

const truthy = new Set(['1', 'true', 'yes', 'on'])

function envDisablesAutoIndexing(): boolean {
  const raw = process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
  if (!raw) return false
  const normalized = raw.trim().toLowerCase()
  return truthy.has(normalized)
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

