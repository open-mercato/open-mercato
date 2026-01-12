import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorAddress, Contractor } from '../data/entities'
import {
  contractorAddressCreateSchema,
  contractorAddressUpdateSchema,
  type ContractorAddressCreateInput,
  type ContractorAddressUpdateInput,
} from '../data/validators'

type AddressCreateInput = ContractorAddressCreateInput & {
  contractorId: string
}

type AddressUpdateInput = ContractorAddressUpdateInput & {
  id: string
}

const createAddressCommand: CommandHandler<AddressCreateInput, { addressId: string }> = {
  id: 'contractors.addresses.create',
  async execute(rawInput, ctx) {
    const parsed = contractorAddressCreateSchema.parse(rawInput)
    const contractorId = rawInput.contractorId

    if (!contractorId) {
      throw new CrudHttpError(400, { error: 'contractorId is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = await em.findOne(Contractor, { id: contractorId, deletedAt: null })
    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    const address = em.create(ContractorAddress, {
      organizationId: contractor.organizationId,
      tenantId: contractor.tenantId,
      contractor,
      purpose: parsed.purpose,
      addressLine: parsed.addressLine ?? null,
      city: parsed.city ?? null,
      state: parsed.state ?? null,
      postalCode: parsed.postalCode ?? null,
      country: parsed.country ?? null,
      isPrimary: parsed.isPrimary ?? false,
      isActive: parsed.isActive ?? true,
    })

    em.persist(address)
    await em.flush()

    return { addressId: address.id }
  },
}

const updateAddressCommand: CommandHandler<AddressUpdateInput, { addressId: string }> = {
  id: 'contractors.addresses.update',
  async execute(rawInput, ctx) {
    const parsed = contractorAddressUpdateSchema.parse(rawInput)
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Address id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(ContractorAddress, { id })

    if (!address) {
      throw new CrudHttpError(404, { error: 'Address not found' })
    }

    if (parsed.purpose !== undefined) address.purpose = parsed.purpose
    if (parsed.addressLine !== undefined) address.addressLine = parsed.addressLine ?? null
    if (parsed.city !== undefined) address.city = parsed.city ?? null
    if (parsed.state !== undefined) address.state = parsed.state ?? null
    if (parsed.postalCode !== undefined) address.postalCode = parsed.postalCode ?? null
    if (parsed.country !== undefined) address.country = parsed.country ?? null
    if (parsed.isPrimary !== undefined) address.isPrimary = parsed.isPrimary
    if (parsed.isActive !== undefined) address.isActive = parsed.isActive

    await em.flush()

    return { addressId: address.id }
  },
}

const deleteAddressCommand: CommandHandler<{ id: string }, { addressId: string }> = {
  id: 'contractors.addresses.delete',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Address id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const address = await em.findOne(ContractorAddress, { id })

    if (!address) {
      throw new CrudHttpError(404, { error: 'Address not found' })
    }

    await em.removeAndFlush(address)

    return { addressId: id }
  },
}

registerCommand(createAddressCommand)
registerCommand(updateAddressCommand)
registerCommand(deleteAddressCommand)
