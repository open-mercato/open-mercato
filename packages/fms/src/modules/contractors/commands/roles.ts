import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorRole, Contractor, ContractorRoleType } from '../data/entities'
import {
  contractorRoleAssignSchema,
  contractorRoleUpdateSchema,
  type ContractorRoleAssignInput,
  type ContractorRoleUpdateInput,
} from '../data/validators'

type RoleAssignInput = ContractorRoleAssignInput & {
  contractorId: string
}

type RoleUpdateInput = ContractorRoleUpdateInput & {
  id: string
}

const assignRoleCommand: CommandHandler<RoleAssignInput, { roleId: string }> = {
  id: 'contractors.roles.assign',
  async execute(rawInput, ctx) {
    const parsed = contractorRoleAssignSchema.parse(rawInput)
    const contractorId = rawInput.contractorId

    if (!contractorId) {
      throw new CrudHttpError(400, { error: 'contractorId is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = await em.findOne(Contractor, { id: contractorId, deletedAt: null })
    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    const roleType = await em.findOne(ContractorRoleType, { id: parsed.roleTypeId, isActive: true })
    if (!roleType) {
      throw new CrudHttpError(404, { error: 'Role type not found' })
    }

    // Check if role already assigned
    const existingRole = await em.findOne(ContractorRole, { contractor, roleType })
    if (existingRole) {
      throw new CrudHttpError(409, { error: 'Role already assigned to this contractor' })
    }

    const role = em.create(ContractorRole, {
      organizationId: contractor.organizationId,
      tenantId: contractor.tenantId,
      contractor,
      roleType,
      settings: parsed.settings ?? null,
      isActive: parsed.isActive ?? true,
      effectiveFrom: parsed.effectiveFrom ?? null,
      effectiveTo: parsed.effectiveTo ?? null,
    })

    em.persist(role)
    await em.flush()

    return { roleId: role.id }
  },
}

const updateRoleCommand: CommandHandler<RoleUpdateInput, { roleId: string }> = {
  id: 'contractors.roles.update',
  async execute(rawInput, ctx) {
    const parsed = contractorRoleUpdateSchema.parse(rawInput)
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Role id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await em.findOne(ContractorRole, { id })

    if (!role) {
      throw new CrudHttpError(404, { error: 'Role not found' })
    }

    if (parsed.settings !== undefined) role.settings = parsed.settings ?? null
    if (parsed.isActive !== undefined) role.isActive = parsed.isActive
    if (parsed.effectiveFrom !== undefined) role.effectiveFrom = parsed.effectiveFrom ?? null
    if (parsed.effectiveTo !== undefined) role.effectiveTo = parsed.effectiveTo ?? null

    await em.flush()

    return { roleId: role.id }
  },
}

const removeRoleCommand: CommandHandler<{ id: string }, { roleId: string }> = {
  id: 'contractors.roles.remove',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Role id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await em.findOne(ContractorRole, { id })

    if (!role) {
      throw new CrudHttpError(404, { error: 'Role not found' })
    }

    await em.removeAndFlush(role)

    return { roleId: id }
  },
}

registerCommand(assignRoleCommand)
registerCommand(updateRoleCommand)
registerCommand(removeRoleCommand)
