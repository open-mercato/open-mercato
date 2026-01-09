import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BookingAvailabilityRuleSet } from '../data/entities'
import {
  bookingAvailabilityRuleSetCreateSchema,
  bookingAvailabilityRuleSetUpdateSchema,
  type BookingAvailabilityRuleSetCreateInput,
  type BookingAvailabilityRuleSetUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetCreateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.create',
  async execute(input, ctx) {
    const parsed = bookingAvailabilityRuleSetCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingAvailabilityRuleSet, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      timezone: parsed.timezone,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(record)
    await em.flush()
    return { ruleSetId: record.id }
  },
}

const updateAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetUpdateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.update',
  async execute(input, ctx) {
    const parsed = bookingAvailabilityRuleSetUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingAvailabilityRuleSet, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule set not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone
    record.updatedAt = new Date()
    await em.flush()
    return { ruleSetId: record.id }
  },
}

const deleteAvailabilityRuleSetCommand: CommandHandler<{ id?: string }, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.delete',
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Availability rule set id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingAvailabilityRuleSet, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule set not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
    return { ruleSetId: record.id }
  },
}

registerCommand(createAvailabilityRuleSetCommand)
registerCommand(updateAvailabilityRuleSetCommand)
registerCommand(deleteAvailabilityRuleSetCommand)
