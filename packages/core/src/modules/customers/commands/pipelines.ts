import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerPipeline, CustomerDeal } from '../data/entities'
import {
  pipelineCreateSchema,
  pipelineUpdateSchema,
  pipelineDeleteSchema,
  type PipelineCreateInput,
  type PipelineUpdateInput,
  type PipelineDeleteInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const createPipelineCommand: CommandHandler<PipelineCreateInput, { pipelineId: string }> = {
  id: 'customers.pipelines.create',
  async execute(rawInput, ctx) {
    const parsed = pipelineCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (parsed.isDefault) {
      await em.nativeUpdate(
        CustomerPipeline,
        { organizationId: parsed.organizationId, tenantId: parsed.tenantId, isDefault: true },
        { isDefault: false }
      )
    }

    const pipeline = em.create(CustomerPipeline, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      isDefault: parsed.isDefault ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(pipeline)
    await em.flush()

    return { pipelineId: pipeline.id }
  },
}

const updatePipelineCommand: CommandHandler<PipelineUpdateInput, void> = {
  id: 'customers.pipelines.update',
  async execute(rawInput, ctx) {
    const parsed = pipelineUpdateSchema.parse(rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await em.findOne(CustomerPipeline, { id: parsed.id })
    if (!pipeline) throw new CrudHttpError(404, { error: 'Pipeline not found' })

    ensureTenantScope(ctx, pipeline.tenantId)
    ensureOrganizationScope(ctx, pipeline.organizationId)

    if (parsed.isDefault && !pipeline.isDefault) {
      await em.nativeUpdate(
        CustomerPipeline,
        { organizationId: pipeline.organizationId, tenantId: pipeline.tenantId, isDefault: true },
        { isDefault: false }
      )
    }

    if (parsed.name !== undefined) pipeline.name = parsed.name
    if (parsed.isDefault !== undefined) pipeline.isDefault = parsed.isDefault
    pipeline.updatedAt = new Date()

    await em.flush()
  },
}

const deletePipelineCommand: CommandHandler<PipelineDeleteInput, void> = {
  id: 'customers.pipelines.delete',
  async execute(rawInput, ctx) {
    const parsed = pipelineDeleteSchema.parse(rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const pipeline = await em.findOne(CustomerPipeline, { id: parsed.id })
    if (!pipeline) throw new CrudHttpError(404, { error: 'Pipeline not found' })

    ensureTenantScope(ctx, pipeline.tenantId)
    ensureOrganizationScope(ctx, pipeline.organizationId)

    const activeDealsCount = await em.count(CustomerDeal, {
      pipelineId: parsed.id,
      deletedAt: null,
    })
    if (activeDealsCount > 0) {
      throw new CrudHttpError(409, { error: 'Cannot delete pipeline with active deals' })
    }

    em.remove(pipeline)
    await em.flush()
  },
}

registerCommand(createPipelineCommand)
registerCommand(updatePipelineCommand)
registerCommand(deletePipelineCommand)

export { createPipelineCommand, updatePipelineCommand, deletePipelineCommand }
