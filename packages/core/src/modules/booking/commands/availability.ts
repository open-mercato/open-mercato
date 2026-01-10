import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BookingAvailabilityRule } from '../data/entities'
import {
  bookingAvailabilityRuleCreateSchema,
  bookingAvailabilityRuleUpdateSchema,
  type BookingAvailabilityRuleCreateInput,
  type BookingAvailabilityRuleUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createAvailabilityRuleCommand: CommandHandler<BookingAvailabilityRuleCreateInput, { ruleId: string }> = {
  id: 'booking.availability.create',
  async execute(input, ctx) {
    const parsed = bookingAvailabilityRuleCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingAvailabilityRule, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      timezone: parsed.timezone,
      rrule: parsed.rrule,
      exdates: parsed.exdates ?? [],
      kind: parsed.kind ?? 'availability',
      note: parsed.note ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { ruleId: record.id }
  },
}

const updateAvailabilityRuleCommand: CommandHandler<BookingAvailabilityRuleUpdateInput, { ruleId: string }> = {
  id: 'booking.availability.update',
  async execute(input, ctx) {
    const parsed = bookingAvailabilityRuleUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingAvailabilityRule, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.subjectType !== undefined) record.subjectType = parsed.subjectType
    if (parsed.subjectId !== undefined) record.subjectId = parsed.subjectId
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone
    if (parsed.rrule !== undefined) record.rrule = parsed.rrule
    if (parsed.exdates !== undefined) record.exdates = parsed.exdates
    if (parsed.kind !== undefined) record.kind = parsed.kind
    if (parsed.note !== undefined) record.note = parsed.note ?? null

    await em.flush()
    return { ruleId: record.id }
  },
}

const deleteAvailabilityRuleCommand: CommandHandler<{ id?: string }, { ruleId: string }> = {
  id: 'booking.availability.delete',
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Availability rule id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingAvailabilityRule, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
    return { ruleId: record.id }
  },
}

registerCommand(createAvailabilityRuleCommand)
registerCommand(updateAvailabilityRuleCommand)
registerCommand(deleteAvailabilityRuleCommand)
