import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerPipelineStage, CustomerDeal } from '../data/entities'
import {
  pipelineStageCreateSchema,
  pipelineStageUpdateSchema,
  pipelineStageDeleteSchema,
  pipelineStageReorderSchema,
  type PipelineStageCreateInput,
  type PipelineStageUpdateInput,
  type PipelineStageDeleteInput,
  type PipelineStageReorderInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, ensureDictionaryEntry } from './shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const createPipelineStageCommand: CommandHandler<PipelineStageCreateInput, { stageId: string }> = {
  id: 'customers.pipeline-stages.create',
  async execute(rawInput, ctx) {
    const parsed = pipelineStageCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const existingCount = await em.count(CustomerPipelineStage, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      pipelineId: parsed.pipelineId,
    })

    const stage = em.create(CustomerPipelineStage, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      pipelineId: parsed.pipelineId,
      label: parsed.label,
      order: parsed.order ?? existingCount,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(stage)
    await em.flush()

    await ensureDictionaryEntry(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      kind: 'pipeline_stage',
      value: stage.label,
      color: parsed.color,
      icon: parsed.icon,
    })
    await em.flush()

    return { stageId: stage.id }
  },
}

const updatePipelineStageCommand: CommandHandler<PipelineStageUpdateInput, void> = {
  id: 'customers.pipeline-stages.update',
  async execute(rawInput, ctx) {
    const parsed = pipelineStageUpdateSchema.parse(rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const stage = await em.findOne(CustomerPipelineStage, { id: parsed.id })
    if (!stage) throw new CrudHttpError(404, { error: 'Pipeline stage not found' })

    ensureTenantScope(ctx, stage.tenantId)
    ensureOrganizationScope(ctx, stage.organizationId)

    if (parsed.label !== undefined) stage.label = parsed.label
    if (parsed.order !== undefined) stage.order = parsed.order
    stage.updatedAt = new Date()

    await em.flush()

    if (parsed.label !== undefined || parsed.color !== undefined || parsed.icon !== undefined) {
      await ensureDictionaryEntry(em, {
        tenantId: stage.tenantId,
        organizationId: stage.organizationId,
        kind: 'pipeline_stage',
        value: stage.label,
        color: parsed.color,
        icon: parsed.icon,
      })
      await em.flush()
    }
  },
}

const deletePipelineStageCommand: CommandHandler<PipelineStageDeleteInput, void> = {
  id: 'customers.pipeline-stages.delete',
  async execute(rawInput, ctx) {
    const parsed = pipelineStageDeleteSchema.parse(rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const stage = await em.findOne(CustomerPipelineStage, { id: parsed.id })
    if (!stage) throw new CrudHttpError(404, { error: 'Pipeline stage not found' })

    ensureTenantScope(ctx, stage.tenantId)
    ensureOrganizationScope(ctx, stage.organizationId)

    const activeDealsCount = await em.count(CustomerDeal, {
      pipelineStageId: parsed.id,
      deletedAt: null,
    })
    if (activeDealsCount > 0) {
      throw new CrudHttpError(409, { error: 'Cannot delete pipeline stage with active deals' })
    }

    em.remove(stage)
    await em.flush()
  },
}

const reorderPipelineStagesCommand: CommandHandler<PipelineStageReorderInput, void> = {
  id: 'customers.pipeline-stages.reorder',
  async execute(rawInput, ctx) {
    const parsed = pipelineStageReorderSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const ids = parsed.stages.map((s) => s.id)
    const stages = await em.find(CustomerPipelineStage, {
      id: { $in: ids },
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })

    const stageMap = new Map<string, CustomerPipelineStage>()
    stages.forEach((stage) => stageMap.set(stage.id, stage))

    for (const { id, order } of parsed.stages) {
      const stage = stageMap.get(id)
      if (!stage) continue
      stage.order = order
      stage.updatedAt = new Date()
    }

    await em.flush()
  },
}

registerCommand(createPipelineStageCommand)
registerCommand(updatePipelineStageCommand)
registerCommand(deletePipelineStageCommand)
registerCommand(reorderPipelineStagesCommand)

export {
  createPipelineStageCommand,
  updatePipelineStageCommand,
  deletePipelineStageCommand,
  reorderPipelineStagesCommand,
}
