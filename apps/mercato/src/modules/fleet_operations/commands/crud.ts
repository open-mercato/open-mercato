import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { z } from 'zod'

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
  beforeCreate?: (input: Record<string, unknown>, scope: Scope, ctx: CommandRuntimeContext) => Promise<void>
  afterCreate?: (entity: TEntity, scope: Scope, ctx: CommandRuntimeContext) => Promise<void>
  beforeUpdate?: (input: Record<string, unknown>, current: TEntity, scope: Scope, ctx: CommandRuntimeContext) => Promise<void>
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

export function registerCrudCommands<TEntity extends object>(config: CrudCommandConfig<TEntity>): void {
  const baseId = `fleet_operations.${config.resource}`
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
      await config.afterCreate?.(entity, scope, ctx)
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
      if (!id) throw new CrudHttpError(400, { error: 'Record id is required.' })
      const scope = resolveScope(ctx)
      const em = getEntityManager(ctx)
      const current = await em.findOne(config.entity, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<NoInfer<TEntity>>)
      if (!current) throw new CrudHttpError(404, { error: 'Record not found.' })
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: config.entityId,
        resourceId: id,
        current: (current as { updatedAt?: Date }).updatedAt ?? null,
        request: ctx.request ?? null,
      })
      await config.beforeUpdate?.(input, current, scope, ctx)
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const updated = await dataEngine.updateOrmEntity({
        entity: config.entity,
        where: {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        } as FilterQuery<NoInfer<TEntity>>,
        apply: (record) => {
          Object.assign(record, config.toUpdateData(input), { updatedAt: new Date() })
        },
      })
      if (!updated) throw new CrudHttpError(404, { error: 'Record not found.' })
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
      if (!id) throw new CrudHttpError(400, { error: 'Record id is required.' })
      const scope = resolveScope(ctx)
      const em = getEntityManager(ctx)
      const current = await em.findOne(config.entity, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<NoInfer<TEntity>>)
      if (!current) throw new CrudHttpError(404, { error: 'Record not found.' })
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: config.entityId,
        resourceId: id,
        current: (current as { updatedAt?: Date }).updatedAt ?? null,
        request: ctx.request ?? null,
      })
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      const deleted = await dataEngine.deleteOrmEntity({
        entity: config.entity,
        where: {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        } as FilterQuery<NoInfer<TEntity>>,
        soft: true,
        softDeleteField: 'deletedAt' as keyof TEntity & string,
      })
      if (!deleted) throw new CrudHttpError(404, { error: 'Record not found.' })
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
