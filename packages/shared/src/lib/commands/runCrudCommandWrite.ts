import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from './types'
import type { DataEngine } from '../data/engine'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudEntityIdentifiers,
} from '../crud/types'
import { withAtomicFlush } from './flush'
import { setCustomFieldsIfAny, emitCrudSideEffects } from './helpers'

export type CrudCommandWritePhase = (args: { em: EntityManager }) => void | Promise<void>

export type CrudCommandWriteSideEffectTarget<TEntity> = {
  entity: TEntity
  identifiers: CrudEntityIdentifiers
}

export type CrudCommandWriteScope = {
  tenantId: string | null
  organizationId: string | null
}

export type RunCrudCommandWriteOptions<TEntity> = {
  ctx: CommandRuntimeContext
  entityId: string
  action: CrudEventAction
  scope: CrudCommandWriteScope
  phases: CrudCommandWritePhase[]
  customFields?: Record<string, unknown>
  notifyCustomFields?: boolean
  events?: CrudEventsConfig<TEntity>
  indexer?: CrudIndexerConfig<TEntity>
  syncOrigin?: string | null
  sideEffect: () => CrudCommandWriteSideEffectTarget<TEntity>
  em?: EntityManager
  transaction?: boolean
  dataEngine?: DataEngine
}

export type RunCrudCommandWriteResult = { em: EntityManager }

export async function runCrudCommandWrite<TEntity>(
  opts: RunCrudCommandWriteOptions<TEntity>,
): Promise<RunCrudCommandWriteResult> {
  const em = opts.em ?? (opts.ctx.container.resolve('em') as EntityManager).fork()
  const transaction = opts.transaction ?? true

  await withAtomicFlush(
    em,
    opts.phases.map((phase) => () => phase({ em })),
    { transaction },
  )

  const dataEngine = opts.dataEngine ?? (opts.ctx.container.resolve('dataEngine') as DataEngine)
  const target = opts.sideEffect()

  if (opts.customFields && Object.keys(opts.customFields).length > 0) {
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: opts.entityId,
      recordId: target.identifiers.id,
      tenantId: opts.scope.tenantId,
      organizationId: opts.scope.organizationId,
      values: opts.customFields,
      notify: opts.notifyCustomFields ?? false,
    })
  }

  await emitCrudSideEffects({
    dataEngine,
    action: opts.action,
    entity: target.entity,
    identifiers: target.identifiers,
    syncOrigin: opts.syncOrigin ?? null,
    events: opts.events,
    indexer: opts.indexer,
  })

  return { em }
}
