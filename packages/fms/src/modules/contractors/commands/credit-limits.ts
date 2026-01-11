import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorCreditLimit, Contractor } from '../data/entities'
import {
  contractorCreditLimitUpsertSchema,
  type ContractorCreditLimitUpsertInput,
} from '../data/validators'

type CreditLimitUpsertInput = ContractorCreditLimitUpsertInput & {
  contractorId: string
}

const upsertCreditLimitCommand: CommandHandler<CreditLimitUpsertInput, { creditLimitId: string }> = {
  id: 'contractors.credit-limits.upsert',
  async execute(rawInput, ctx) {
    const parsed = contractorCreditLimitUpsertSchema.parse(rawInput)
    const contractorId = rawInput.contractorId

    if (!contractorId) {
      throw new CrudHttpError(400, { error: 'contractorId is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const contractor = await em.findOne(Contractor, { id: contractorId, deletedAt: null })
    if (!contractor) {
      throw new CrudHttpError(404, { error: 'Contractor not found' })
    }

    let creditLimit = await em.findOne(ContractorCreditLimit, { contractor })

    if (creditLimit) {
      // Update existing
      if (parsed.creditLimit !== undefined) creditLimit.creditLimit = parsed.creditLimit
      if (parsed.currencyCode !== undefined) creditLimit.currencyCode = parsed.currencyCode
      if (parsed.isUnlimited !== undefined) creditLimit.isUnlimited = parsed.isUnlimited
      if (parsed.notes !== undefined) creditLimit.notes = parsed.notes ?? null
    } else {
      // Create new
      creditLimit = em.create(ContractorCreditLimit, {
        organizationId: contractor.organizationId,
        tenantId: contractor.tenantId,
        contractor,
        creditLimit: parsed.creditLimit,
        currencyCode: parsed.currencyCode ?? 'USD',
        isUnlimited: parsed.isUnlimited ?? false,
        notes: parsed.notes ?? null,
      })
      em.persist(creditLimit)
    }

    await em.flush()

    return { creditLimitId: creditLimit.id }
  },
}

const deleteCreditLimitCommand: CommandHandler<{ id: string }, { creditLimitId: string }> = {
  id: 'contractors.credit-limits.delete',
  async execute(rawInput, ctx) {
    const id = rawInput.id

    if (!id) {
      throw new CrudHttpError(400, { error: 'Credit limit id is required' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const creditLimit = await em.findOne(ContractorCreditLimit, { id })

    if (!creditLimit) {
      throw new CrudHttpError(404, { error: 'Credit limit not found' })
    }

    await em.removeAndFlush(creditLimit)

    return { creditLimitId: id }
  },
}

registerCommand(upsertCreditLimitCommand)
registerCommand(deleteCreditLimitCommand)
