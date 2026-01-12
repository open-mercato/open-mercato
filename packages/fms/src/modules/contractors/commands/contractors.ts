import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  Contractor,
  ContractorAddress,
  ContractorContact,
  ContractorPaymentTerms,
  ContractorCreditLimit,
} from '../data/entities'
import {
  contractorCreateSchema,
  contractorUpdateSchema,
  contractorCreateWithRelationsSchema,
  type ContractorCreateInput,
  type ContractorUpdateInput,
  type ContractorCreateWithRelationsInput,
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
  const auth = ctx.auth
  if (!auth || !auth.tenantId || auth.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Tenant scope mismatch' })
  }
}

function ensureOrganizationScope(ctx: CommandRuntimeContext, organizationId: string): void {
  const auth = ctx.auth
  if (!auth || !auth.organizationId || auth.organizationId !== organizationId) {
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

type ScopedContractorCreateWithRelationsInput = ContractorCreateWithRelationsInput & {
  organizationId: string
  tenantId: string
}

type CreateWithRelationsResult = {
  contractorId: string
  createdContacts: number
  createdAddresses: number
  createdPaymentTerms: boolean
  createdCreditLimit: boolean
}

const createContractorWithRelationsCommand: CommandHandler<
  ScopedContractorCreateWithRelationsInput,
  CreateWithRelationsResult
> = {
  id: 'contractors.createWithRelations',
  async execute(rawInput, ctx) {
    const parsed = contractorCreateWithRelationsSchema.parse(rawInput)
    const organizationId = rawInput.organizationId
    const tenantId = rawInput.tenantId

    if (!organizationId || !tenantId) {
      throw new CrudHttpError(400, { error: 'organizationId and tenantId are required' })
    }

    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    return em.transactional(async (tem) => {
      const contractor = tem.create(Contractor, {
        organizationId,
        tenantId,
        name: parsed.name,
        shortName: parsed.shortName ?? null,
        parentId: parsed.parentId ?? null,
        taxId: parsed.taxId ?? null,
        isActive: parsed.isActive ?? true,
        roleTypeIds: parsed.roleTypeIds ?? null,
      })
      tem.persist(contractor)

      const contacts = parsed.contacts ?? []
      for (const contactData of contacts) {
        const contact = tem.create(ContractorContact, {
          organizationId,
          tenantId,
          contractor,
          firstName: contactData.firstName ?? null,
          lastName: contactData.lastName ?? null,
          email: contactData.email ?? null,
          phone: contactData.phone ?? null,
          isPrimary: contactData.isPrimary ?? false,
          isActive: contactData.isActive ?? true,
        })
        tem.persist(contact)
      }

      const addresses = parsed.addresses ?? []
      for (const addressData of addresses) {
        const address = tem.create(ContractorAddress, {
          organizationId,
          tenantId,
          contractor,
          purpose: addressData.purpose,
          addressLine: addressData.addressLine ?? null,
          city: addressData.city ?? null,
          state: addressData.state ?? null,
          postalCode: addressData.postalCode ?? null,
          country: addressData.country ?? null,
          isPrimary: addressData.isPrimary ?? false,
          isActive: addressData.isActive ?? true,
        })
        tem.persist(address)
      }

      let createdPaymentTerms = false
      if (parsed.paymentTerms) {
        const pt = tem.create(ContractorPaymentTerms, {
          organizationId,
          tenantId,
          contractor,
          paymentDays: parsed.paymentTerms.paymentDays ?? 30,
          paymentMethod: parsed.paymentTerms.paymentMethod ?? null,
          currencyCode: parsed.paymentTerms.currencyCode ?? 'USD',
          bankName: parsed.paymentTerms.bankName ?? null,
          bankAccountNumber: parsed.paymentTerms.bankAccountNumber ?? null,
          bankRoutingNumber: parsed.paymentTerms.bankRoutingNumber ?? null,
          iban: parsed.paymentTerms.iban ?? null,
          swiftBic: parsed.paymentTerms.swiftBic ?? null,
          notes: parsed.paymentTerms.notes ?? null,
        })
        tem.persist(pt)
        createdPaymentTerms = true
      }

      let createdCreditLimit = false
      if (parsed.creditLimit) {
        const cl = tem.create(ContractorCreditLimit, {
          organizationId,
          tenantId,
          contractor,
          creditLimit: parsed.creditLimit.creditLimit ?? '0',
          currencyCode: parsed.creditLimit.currencyCode ?? 'USD',
          isUnlimited: parsed.creditLimit.isUnlimited ?? false,
          notes: parsed.creditLimit.notes ?? null,
        })
        tem.persist(cl)
        createdCreditLimit = true
      }

      return {
        contractorId: contractor.id,
        createdContacts: contacts.length,
        createdAddresses: addresses.length,
        createdPaymentTerms,
        createdCreditLimit,
      }
    })
  },
}

registerCommand(createContractorCommand)
registerCommand(updateContractorCommand)
registerCommand(deleteContractorCommand)
registerCommand(createContractorWithRelationsCommand)
