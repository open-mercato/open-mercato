import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { validateConditionExpressionForApi } from '../../business_rules'
import { DataQualityCheck } from '../data/entities'
import {
  createCheckSchema,
  type CreateCheckInput,
  updateCheckSchema,
  type UpdateCheckInput,
} from '../data/validators'

const checkCrudEvents: CrudEventsConfig = {
  module: 'data_quality',
  entity: 'check',
  persistent: true,
  buildPayload: ({ entity, identifiers }) => ({
    id: identifiers.id,
    code: (entity as DataQualityCheck).code,
    tenantId: identifiers.tenantId,
    organizationId: identifiers.organizationId,
  }),
}

const checkCrudIndexer: CrudIndexerConfig = {
  entityType: 'data_quality:checks',
}

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const actorUserId = ctx.auth?.userId ?? ctx.auth?.sub ?? null

  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, 'Organization context is required')
  }

  return { tenantId, organizationId, actorUserId }
}

async function emitCheckCrudSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  check: DataQualityCheck,
  tenantId: string,
  organizationId: string,
) {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: check,
    identifiers: {
      id: check.id,
      tenantId,
      organizationId,
    },
    syncOrigin: ctx.syncOrigin,
    events: checkCrudEvents,
    indexer: checkCrudIndexer,
  })
}

const createCheckCommand: CommandHandler<CreateCheckInput, { id: string }> = {
  id: 'data_quality.check.create',
  async execute(rawInput, ctx) {
    const parsed = createCheckSchema.parse(rawInput)
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const validationResult = validateConditionExpressionForApi(parsed.failureExpression)
    if (!validationResult.valid) {
      throw new CrudHttpError(400, validationResult.error ?? 'Invalid failure expression')
    }

    const existing = await em.findOne(DataQualityCheck, {
      tenantId,
      organizationId,
      code: parsed.code,
    } as never)
    if (existing) {
      throw new CrudHttpError(409, 'A check with this code already exists')
    }

    const check = em.create(DataQualityCheck, {
      code: parsed.code,
      name: parsed.name,
      description: parsed.description ?? null,
      targetEntityType: parsed.targetEntityType,
      failureExpression: parsed.failureExpression,
      severity: parsed.severity,
      weight: parsed.weight ?? 1,
      enabled: parsed.enabled ?? true,
      createdBy: actorUserId,
      tenantId,
      organizationId,
    })

    em.persist(check)
    await em.flush()
    await emitCheckCrudSideEffects(ctx, 'created', check, tenantId, organizationId)

    return { id: check.id }
  },
}

const updateCheckCommand: CommandHandler<UpdateCheckInput & { id: string }, { id: string }> = {
  id: 'data_quality.check.update',
  async execute(rawInput, ctx) {
    const { id, ...updateData } = rawInput
    const parsed = updateCheckSchema.parse(updateData)
    const { tenantId, organizationId, actorUserId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const check = await em.findOne(DataQualityCheck, {
      id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!check) {
      throw new CrudHttpError(404, 'Check not found')
    }

    if (parsed.failureExpression !== undefined) {
      const validationResult = validateConditionExpressionForApi(parsed.failureExpression)
      if (!validationResult.valid) {
        throw new CrudHttpError(400, validationResult.error ?? 'Invalid failure expression')
      }
    }

    if (parsed.name !== undefined) check.name = parsed.name
    if (parsed.description !== undefined) check.description = parsed.description ?? null
    if (parsed.targetEntityType !== undefined) check.targetEntityType = parsed.targetEntityType
    if (parsed.failureExpression !== undefined) check.failureExpression = parsed.failureExpression
    if (parsed.severity !== undefined) check.severity = parsed.severity
    if (parsed.weight !== undefined) check.weight = parsed.weight
    if (parsed.enabled !== undefined) check.enabled = parsed.enabled
    check.updatedBy = actorUserId

    await em.flush()
    await emitCheckCrudSideEffects(ctx, 'updated', check, tenantId, organizationId)

    return { id: check.id }
  },
}

const deleteCheckCommand: CommandHandler<{ id: string }, { id: string }> = {
  id: 'data_quality.check.delete',
  async execute(rawInput, ctx) {
    const { tenantId, organizationId } = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const check = await em.findOne(DataQualityCheck, {
      id: rawInput.id,
      tenantId,
      organizationId,
      deletedAt: null,
    } as never)
    if (!check) {
      throw new CrudHttpError(404, 'Check not found')
    }

    check.deletedAt = new Date()
    await em.flush()
    await emitCheckCrudSideEffects(ctx, 'deleted', check, tenantId, organizationId)

    return { id: check.id }
  },
}

registerCommand(createCheckCommand)
registerCommand(updateCheckCommand)
registerCommand(deleteCheckCommand)
