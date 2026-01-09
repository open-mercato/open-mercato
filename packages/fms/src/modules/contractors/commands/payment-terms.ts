import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorPaymentTerms, Contractor } from '../data/entities'
import {
  contractorPaymentTermsUpsertSchema,
  type ContractorPaymentTermsUpsertInput,
} from '../data/validators'

type PaymentTermsUpsertInput = ContractorPaymentTermsUpsertInput & {
  contractorId: string
}

const upsertPaymentTermsCommand: CommandHandler<PaymentTermsUpsertInput, { paymentTermsId: string }> = {
  id: 'contractors.payment-terms.upsert',
  async execute(rawInput, ctx) {
    const parsed = contractorPaymentTermsUpsertSchema.parse(rawInput)
    const contractorId = rawInput.contractorId

    if (!contractorId) {
      throw new CrudHttpError(400, { error: 'contractorId is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = await em.findOne(Contractor, { id: contractorId, deletedAt: null })
    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    let paymentTerms = await em.findOne(ContractorPaymentTerms, { contractor })

    if (paymentTerms) {
      // Update existing
      if (parsed.paymentDays !== undefined) paymentTerms.paymentDays = parsed.paymentDays
      if (parsed.paymentMethod !== undefined) paymentTerms.paymentMethod = parsed.paymentMethod ?? null
      if (parsed.currencyCode !== undefined) paymentTerms.currencyCode = parsed.currencyCode
      if (parsed.bankName !== undefined) paymentTerms.bankName = parsed.bankName ?? null
      if (parsed.bankAccountNumber !== undefined) paymentTerms.bankAccountNumber = parsed.bankAccountNumber ?? null
      if (parsed.bankRoutingNumber !== undefined) paymentTerms.bankRoutingNumber = parsed.bankRoutingNumber ?? null
      if (parsed.iban !== undefined) paymentTerms.iban = parsed.iban ?? null
      if (parsed.swiftBic !== undefined) paymentTerms.swiftBic = parsed.swiftBic ?? null
      if (parsed.notes !== undefined) paymentTerms.notes = parsed.notes ?? null
    } else {
      // Create new
      paymentTerms = em.create(ContractorPaymentTerms, {
        organizationId: contractor.organizationId,
        tenantId: contractor.tenantId,
        contractor,
        paymentDays: parsed.paymentDays ?? 30,
        paymentMethod: parsed.paymentMethod ?? null,
        currencyCode: parsed.currencyCode ?? 'USD',
        bankName: parsed.bankName ?? null,
        bankAccountNumber: parsed.bankAccountNumber ?? null,
        bankRoutingNumber: parsed.bankRoutingNumber ?? null,
        iban: parsed.iban ?? null,
        swiftBic: parsed.swiftBic ?? null,
        notes: parsed.notes ?? null,
      })
      em.persist(paymentTerms)
    }

    await em.flush()

    return { paymentTermsId: paymentTerms.id }
  },
}

const deletePaymentTermsCommand: CommandHandler<{ id: string }, { paymentTermsId: string }> = {
  id: 'contractors.payment-terms.delete',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Payment terms id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const paymentTerms = await em.findOne(ContractorPaymentTerms, { id })

    if (!paymentTerms) {
      throw new CrudHttpError(404, { error: 'Payment terms not found' })
    }

    await em.removeAndFlush(paymentTerms)

    return { paymentTermsId: id }
  },
}

registerCommand(upsertPaymentTermsCommand)
registerCommand(deletePaymentTermsCommand)
