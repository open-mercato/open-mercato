import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { deferAfterTransactionCommit } from '@open-mercato/shared/lib/db/afterCommit'
import { ModuleConfig } from '../data/entities'
import { moduleConfigKeySchema, type ModuleConfigKey } from '../data/validators'
import type { ModuleConfigService } from './module-config-service'

type InstanceConfigInitialization = ModuleConfigKey & {
  initialValue: unknown
  merge(current: unknown): { value: unknown } | undefined
}

export type InstanceConfigInitializer = {
  initialize(em: EntityManager, input: InstanceConfigInitialization): Promise<void>
}

export function createInstanceConfigInitializer(container: AppContainer): InstanceConfigInitializer {
  const configService = container.resolve<ModuleConfigService>('moduleConfigService')
  return {
    async initialize(setupEm, input) {
      const { moduleId, name } = moduleConfigKeySchema.parse(input)
      const where = { moduleId, name, tenantId: null, organizationId: null }
      const em = setupEm.getContext(false)

      const initialize = async (txEm: EntityManager): Promise<boolean> => {
        const lockRow = () => txEm.findOne(ModuleConfig, where, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
        let row = await lockRow()
        if (!row) {
          const inserted = await txEm.execute<Array<{ id: string }>>(
            `insert into "module_configs"
               ("module_id", "name", "value_json", "tenant_id", "organization_id", "created_at", "updated_at")
             values (?, ?, ?::jsonb, null, null, now(), now())
             on conflict ("module_id", "name") where "tenant_id" is null do nothing
             returning "id"`,
            [moduleId, name, JSON.stringify(input.initialValue ?? null)],
          )
          if (inserted.length > 0) return true
          row = await lockRow()
          if (!row) throw new Error('[internal] Instance config key conflicts with a row outside the instance scope')
        }

        const merged = input.merge(row.valueJson)
        if (!merged) return false
        row.valueJson = merged.value ?? null
        await txEm.flush()
        return true
      }

      const changed = em.isInTransaction() ? await initialize(em) : await em.transactional(initialize)
      if (changed) {
        await deferAfterTransactionCommit(em, () => configService.invalidate(moduleId, name))
      }
    },
  }
}
