import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { z } from 'zod'
import { raiseFinancialError } from '../lib/errors'

type Scope = { tenantId: string; organizationId: string }

type CrudCommandConfig<TEntity extends object> = {
  entity: EntityName<TEntity>
  entityId: string
  resource: string
  createSchema: z.ZodTypeAny
  updateSchema: z.ZodTypeAny
  toCreateData: (input: Record<string, unknown>) => EntityData<TEntity>
  toUpdateData: (input: Record<string, unknown>) => EntityData<TEntity>
  events: CrudEventsConfig<TEntity>
  indexer: CrudIndexerConfig<TEntity>
  /** Set to `false` for entities that are never archived (periods, entries). */
  softDelete?: boolean
  /**
   * Business rules that must run before the row is written — a uniqueness check,
   * a referenced account that has to exist. They live here rather than in the
   * route so every writer of the entity obeys them, and they run **before** the
   * data engine's write so a refusal costs no transaction.
   */
  beforeCreate?: (input: Record<string, unknown>, scope: Scope, ctx: CommandRuntimeContext) => Promise<void>
  beforeUpdate?: (
    input: Record<string, unknown>,
    current: TEntity,
    scope: Scope,
    ctx: CommandRuntimeContext,
  ) => Promise<void>
}

function resolveScope(ctx: CommandRuntimeContext): Scope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Tenant and organization context are required.' })
  }
  return { tenantId, organizationId }
}

function getEntityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scopedWhere<TEntity extends object>(
  config: CrudCommandConfig<TEntity>,
  scope: Scope,
  id: string,
): FilterQuery<NoInfer<TEntity>> {
  const base = { id, tenantId: scope.tenantId, organizationId: scope.organizationId }
  return (config.softDelete === false ? base : { ...base, deletedAt: null }) as FilterQuery<NoInfer<TEntity>>
}

function registerCrudCommands<TEntity extends object>(config: CrudCommandConfig<TEntity>): void {
  const baseId = `financial.${config.resource}`

  const createCommand: CommandHandler<Record<string, unknown>, TEntity> = {
    id: `${baseId}.create`,
    async execute(raw, ctx) {
      const input = config.createSchema.parse(raw) as Record<string, unknown>
      const scope = resolveScope(ctx)
      await config.beforeCreate?.(input, scope, ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const entity = await dataEngine.createOrmEntity({
        entity: config.entity,
        data: {
          ...config.toCreateData(input),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          createdBy: ctx.auth?.sub ?? null,
          updatedBy: ctx.auth?.sub ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as EntityData<TEntity>,
      })
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity,
        identifiers: { id: String((entity as { id: string }).id), ...scope },
        actorUserId: ctx.auth?.sub ?? null,
        events: config.events,
        indexer: config.indexer,
      })
      return entity
    },
    buildLog: ({ result, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `Create ${config.resource.replaceAll('_', ' ')}`,
        resourceKind: config.entityId,
        resourceId: String((result as { id: string }).id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }

  const updateCommand: CommandHandler<Record<string, unknown>, TEntity> = {
    id: `${baseId}.update`,
    async execute(raw, ctx) {
      const input = config.updateSchema.parse(raw) as Record<string, unknown>
      const id = typeof input.id === 'string' ? input.id : null
      if (!id) return raiseFinancialError(400, 'entry_number_required')
      const scope = resolveScope(ctx)
      const em = getEntityManager(ctx)
      const current = await em.findOne(config.entity, scopedWhere(config, scope, id))
      if (!current) throw new CrudHttpError(404, { error: '[internal] Record not found.' })
      // The hook sees the loaded row so a partial update can check the values it
      // is not changing — a plate the caller did not send still has to be unique.
      await config.beforeUpdate?.(input, current, scope, ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const updated = await dataEngine.updateOrmEntity({
        entity: config.entity,
        where: scopedWhere(config, scope, id),
        apply: (record) => {
          Object.assign(record, config.toUpdateData(input), {
            updatedAt: new Date(),
            updatedBy: ctx.auth?.sub ?? null,
          })
        },
      })
      if (!updated) throw new CrudHttpError(404, { error: '[internal] Record not found.' })
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: updated,
        identifiers: { id, ...scope },
        actorUserId: ctx.auth?.sub ?? null,
        events: config.events,
        indexer: config.indexer,
      })
      return updated
    },
    buildLog: ({ input, result, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `Update ${config.resource.replaceAll('_', ' ')}`,
        resourceKind: config.entityId,
        resourceId: String((result as { id: string }).id ?? input.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }

  const deleteCommand: CommandHandler<Record<string, unknown>, { id: string }> = {
    id: `${baseId}.delete`,
    async execute(raw, ctx) {
      const input = isRecord(raw) ? raw : {}
      const id = typeof input.id === 'string' ? input.id : null
      if (!id) return raiseFinancialError(400, 'entry_number_required')
      const scope = resolveScope(ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const deleted = await dataEngine.deleteOrmEntity({
        entity: config.entity,
        where: scopedWhere(config, scope, id),
        ...(config.softDelete === false
          ? { soft: false }
          : { soft: true, softDeleteField: 'deletedAt' as keyof TEntity & string }),
      })
      if (!deleted) throw new CrudHttpError(404, { error: '[internal] Record not found.' })
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: deleted,
        identifiers: { id, ...scope },
        actorUserId: ctx.auth?.sub ?? null,
        events: config.events,
        indexer: config.indexer,
      })
      return { id }
    },
    buildLog: ({ input, ctx }) => {
      const scope = resolveScope(ctx)
      return {
        actionLabel: `Delete ${config.resource.replaceAll('_', ' ')}`,
        resourceKind: config.entityId,
        resourceId: String(input.id ?? ''),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      }
    },
  }

  registerCommand(createCommand)
  registerCommand(updateCommand)
  registerCommand(deleteCommand)
}

export { registerCrudCommands }

