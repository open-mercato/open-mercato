import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BookingResourceType } from '../data/entities'
import {
  bookingResourceTypeCreateSchema,
  bookingResourceTypeUpdateSchema,
  type BookingResourceTypeCreateInput,
  type BookingResourceTypeUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createResourceTypeCommand: CommandHandler<BookingResourceTypeCreateInput, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.create',
  async execute(input, ctx) {
    const parsed = bookingResourceTypeCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingResourceType, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { resourceTypeId: record.id }
  },
}

const updateResourceTypeCommand: CommandHandler<BookingResourceTypeUpdateInput, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.update',
  async execute(input, ctx) {
    const parsed = bookingResourceTypeUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResourceType, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null

    await em.flush()
    return { resourceTypeId: record.id }
  },
}

const deleteResourceTypeCommand: CommandHandler<{ id?: string }, { resourceTypeId: string }> = {
  id: 'booking.resourceTypes.delete',
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource type id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResourceType, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource type not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
    return { resourceTypeId: record.id }
  },
}

registerCommand(createResourceTypeCommand)
registerCommand(updateResourceTypeCommand)
registerCommand(deleteResourceTypeCommand)
