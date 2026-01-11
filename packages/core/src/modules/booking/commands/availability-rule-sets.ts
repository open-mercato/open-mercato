import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BookingAvailabilityRuleSet, BookingResource, BookingTeamMember } from '../data/entities'
import {
  bookingAvailabilityRuleSetCreateSchema,
  bookingAvailabilityRuleSetUpdateSchema,
  type BookingAvailabilityRuleSetCreateInput,
  type BookingAvailabilityRuleSetUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import { E } from '@/generated/entities.ids.generated'

const createAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetCreateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.create',
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingAvailabilityRuleSetCreateSchema, input)
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
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_availability_rule_set,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })
    return { ruleSetId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.create', 'Create availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
      resourceId: result?.ruleSetId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetUpdateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.update',
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingAvailabilityRuleSetUpdateSchema, input)
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
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_availability_rule_set,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })
    return { ruleSetId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.update', 'Update availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
      resourceId: result?.ruleSetId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
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

    const assignedResourceCount = await em.count(BookingResource, {
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      availabilityRuleSetId: record.id,
      deletedAt: null,
    })
    const assignedMemberCount = await em.count(BookingTeamMember, {
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      availabilityRuleSetId: record.id,
      deletedAt: null,
    })
    if (assignedResourceCount > 0 || assignedMemberCount > 0) {
      const { t } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: t(
          'booking.availabilityRuleSets.errors.assigned',
          'Schedule is assigned to a resource or team member and cannot be deleted.',
        ),
      })
    }

    record.deletedAt = new Date()
    await em.flush()
    return { ruleSetId: record.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.delete', 'Delete availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
      resourceId: result?.ruleSetId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createAvailabilityRuleSetCommand)
registerCommand(updateAvailabilityRuleSetCommand)
registerCommand(deleteAvailabilityRuleSetCommand)
