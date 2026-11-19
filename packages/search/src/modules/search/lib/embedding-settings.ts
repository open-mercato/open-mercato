import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { withAdvisoryXactLock } from '@open-mercato/shared/lib/db/advisoryLock'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { EmbeddingProviderConfig } from '../../../vector'
import { resolveEmbeddingConfig, saveEmbeddingConfig } from './embedding-config'
import { SEARCH_AUTO_INDEX_CONFIG_KEY } from './auto-indexing'

export async function saveEmbeddingSettings(
  container: AppContainer,
  input: {
    tenantId: string
    embeddingConfig?: EmbeddingProviderConfig
    autoIndexingEnabled?: boolean
    request: Request
  },
): Promise<EmbeddingProviderConfig | null> {
  const scope = { tenantId: input.tenantId }
  const result = await withAdvisoryXactLock(
    container.resolve<EntityManager>('em'),
    `search_embedding_settings:${input.tenantId}`,
    async (transactionEm) => {
      const transactionContainer = {
        resolve: <T,>(name: string): T => {
          if (name === 'em') return transactionEm as T
          if (name === 'cache') return null as T
          return container.resolve<T>(name)
        },
      } as AppContainer
      const service = createModuleConfigService(transactionContainer)
      const resolver = {
        resolve: <T,>(name: string): T => name === 'moduleConfigService'
          ? service as T
          : transactionContainer.resolve<T>(name),
      }
      if (input.embeddingConfig) {
        const current = await resolveEmbeddingConfig(resolver, { scope })
        await enforceCommandOptimisticLockWithGuards(container, {
          resourceKind: 'search.embedding_config',
          resourceId: input.tenantId,
          current: current?.updatedAt ?? '1970-01-01T00:00:00.000Z',
          request: input.request,
        })
        await saveEmbeddingConfig(resolver, input.embeddingConfig, { scope })
      }
      if (input.autoIndexingEnabled !== undefined) {
        await service.setValue('vector', SEARCH_AUTO_INDEX_CONFIG_KEY, input.autoIndexingEnabled, scope)
      }
      return resolveEmbeddingConfig(resolver, { scope })
    },
  )
  await container.resolve<ReturnType<typeof createModuleConfigService>>('moduleConfigService').invalidate('vector', undefined, scope)
  return result
}
