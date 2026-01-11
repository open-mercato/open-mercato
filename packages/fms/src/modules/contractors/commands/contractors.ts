import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Contractor } from '../data/entities'
import {
  contractorCreateSchema,
  contractorUpdateSchema,
  type ContractorCreateInput,
  type ContractorUpdateInput,
} from '../data/validators'

type ScopedContractorCreateInput = ContractorCreateInput & {
  organizationId: string
  tenantId: string
}

type ScopedContractorUpdateInput = ContractorUpdateInput & {
  id: string
  organizationId?: string
  tenantId?: string
}

function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  if (ctx.tenantId && ctx.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Tenant scope mismatch' })
  }
}

function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  if (ctx.organizationId && ctx.organizationId !== organizationId) {
    throw new CrudHttpError(403, { error: 'Organization scope mismatch' })
  }
}

const createContractorCommand: CommandHandler<ScopedContractorCreateInput, { contractorId: string }> = {
  id: 'contractors.create',
  async execute(rawInput, ctx) {
    const parsed = contractorCreateSchema.parse(rawInput)
    const organizationId = rawInput.organizationId
    const tenantId = rawInput.tenantId

    if (!organizationId || !tenantId) {
      throw new CrudHttpError(400, { error: 'organizationId and tenantId are required' })
    }

    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = em.create(Contractor, {
      organizationId,
      tenantId,
      name: parsed.name,
      shortName: parsed.shortName ?? null,
      parentId: parsed.parentId ?? null,
      taxId: parsed.taxId ?? null,
      isActive: parsed.isActive ?? true,
    })

    em.persist(contractor)
    await em.flush()

    return { contractorId: contractor.id }
  },
}

const updateContractorCommand: CommandHandler<ScopedContractorUpdateInput, { contractorId: string }> = {
  id: 'contractors.update',
  async execute(rawInput, ctx) {
    const parsed = contractorUpdateSchema.parse(rawInput)
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Contractor id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const contractor = await em.findOne(Contractor, { id, deletedAt: null })

    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    ensureTenantScope(ctx, contractor.tenantId)
    ensureOrganizationScope(ctx, contractor.organizationId)

    if (parsed.name !== undefined) contractor.name = parsed.name
    if (parsed.shortName !== undefined) contractor.shortName = parsed.shortName ?? null
    if (parsed.parentId !== undefined) contractor.parentId = parsed.parentId ?? null
    if (parsed.taxId !== undefined) contractor.taxId = parsed.taxId ?? null
    if (parsed.isActive !== undefined) contractor.isActive = parsed.isActive

    await em.flush()

    return { contractorId: contractor.id }
  },
}

const deleteContractorCommand: CommandHandler<{ id: string }, { contractorId: string }> = {
  id: 'contractors.delete',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Contractor id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const contractor = await em.findOne(Contractor, { id, deletedAt: null })

    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    ensureTenantScope(ctx, contractor.tenantId)
    ensureOrganizationScope(ctx, contractor.organizationId)

    contractor.deletedAt = new Date()
    await em.flush()

    return { contractorId: contractor.id }
  },
}

registerCommand(createContractorCommand)
registerCommand(updateContractorCommand)
registerCommand(deleteContractorCommand)
