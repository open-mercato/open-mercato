import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorContact, Contractor } from '../data/entities'
import {
  contractorContactCreateSchema,
  contractorContactUpdateSchema,
  type ContractorContactCreateInput,
  type ContractorContactUpdateInput,
} from '../data/validators'

type ContactCreateInput = ContractorContactCreateInput & {
  contractorId: string
}

type ContactUpdateInput = ContractorContactUpdateInput & {
  id: string
}

const createContactCommand: CommandHandler<ContactCreateInput, { contactId: string }> = {
  id: 'contractors.contacts.create',
  async execute(rawInput, ctx) {
    const parsed = contractorContactCreateSchema.parse(rawInput)
    const contractorId = rawInput.contractorId

    if (!contractorId) {
      throw new CrudHttpError(400, { error: 'contractorId is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = await em.findOne(Contractor, { id: contractorId, deletedAt: null })
    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    const contact = em.create(ContractorContact, {
      organizationId: contractor.organizationId,
      tenantId: contractor.tenantId,
      contractor,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: parsed.email ?? null,
      phone: parsed.phone ?? null,
      isPrimary: parsed.isPrimary ?? false,
      isActive: parsed.isActive ?? true,
    })

    em.persist(contact)
    await em.flush()

    return { contactId: contact.id }
  },
}

const updateContactCommand: CommandHandler<ContactUpdateInput, { contactId: string }> = {
  id: 'contractors.contacts.update',
  async execute(rawInput, ctx) {
    const parsed = contractorContactUpdateSchema.parse(rawInput)
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Contact id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const contact = await em.findOne(ContractorContact, { id })

    if (!contact) {
      throw new CrudHttpError(404, { error: 'Contact not found' })
    }

    if (parsed.firstName !== undefined) contact.firstName = parsed.firstName
    if (parsed.lastName !== undefined) contact.lastName = parsed.lastName
    if (parsed.email !== undefined) contact.email = parsed.email ?? null
    if (parsed.phone !== undefined) contact.phone = parsed.phone ?? null
    if (parsed.isPrimary !== undefined) contact.isPrimary = parsed.isPrimary
    if (parsed.isActive !== undefined) contact.isActive = parsed.isActive

    await em.flush()

    return { contactId: contact.id }
  },
}

const deleteContactCommand: CommandHandler<{ id: string }, { contactId: string }> = {
  id: 'contractors.contacts.delete',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Contact id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const contact = await em.findOne(ContractorContact, { id })

    if (!contact) {
      throw new CrudHttpError(404, { error: 'Contact not found' })
    }

    await em.removeAndFlush(contact)

    return { contactId: id }
  },
}

registerCommand(createContactCommand)
registerCommand(updateContactCommand)
registerCommand(deleteContactCommand)
