import type { EntityManager } from '@mikro-orm/postgresql'
import type { VectorIndexService } from '@open-mercato/vector'
import { reindexEntity } from '@open-mercato/core/modules/query_index/lib/reindexer'
import { E } from '@open-mercato/generated/entity-ids'

type ModuleId = keyof typeof E

type ReindexModulesOptions = {
  tenantId?: string | null
  organizationId?: string | null
  vectorService?: VectorIndexService | null
  onEntityStart?: (entityId: string) => void
}

export function moduleEntityIds(modules: ModuleId[]): string[] {
  const collected: string[] = []
  for (const moduleId of modules) {
    const entries = E[moduleId]
    if (!entries) continue
    for (const value of Object.values(entries)) {
      if (typeof value === 'string') collected.push(value)
    }
  }
  return Array.from(new Set(collected))
}

export async function reindexModules(
  em: EntityManager,
  modules: ModuleId[],
  options: ReindexModulesOptions = {},
): Promise<void> {
  const entityIds = moduleEntityIds(modules)
  if (!entityIds.length) return

  for (const entityType of entityIds) {
    options.onEntityStart?.(entityType)
    await reindexEntity(em, {
      entityType,
      tenantId: options.tenantId,
      organizationId: options.organizationId,
      force: true,
      vectorService: options.vectorService ?? undefined,
    })
  }
}
