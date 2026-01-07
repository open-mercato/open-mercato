import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { BookingResource } from '../data/entities'
import {
  bookingResourceCreateSchema,
  bookingResourceUpdateSchema,
  type BookingResourceCreateInput,
  type BookingResourceUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createResourceCommand: CommandHandler<BookingResourceCreateInput, { resourceId: string }> = {
  id: 'booking.resources.create',
  async execute(input, ctx) {
    const parsed = bookingResourceCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingResource, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      resourceTypeId: parsed.resourceTypeId ?? null,
      capacity: parsed.capacity ?? null,
      tags: parsed.tags ?? [],
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { resourceId: record.id }
  },
}

const updateResourceCommand: CommandHandler<BookingResourceUpdateInput, { resourceId: string }> = {
  id: 'booking.resources.update',
  async execute(input, ctx) {
    const parsed = bookingResourceUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResource, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.resourceTypeId !== undefined) record.resourceTypeId = parsed.resourceTypeId ?? null
    if (parsed.capacity !== undefined) record.capacity = parsed.capacity ?? null
    if (parsed.tags !== undefined) record.tags = parsed.tags
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive

    await em.flush()
    return { resourceId: record.id }
  },
}

const deleteResourceCommand: CommandHandler<{ id?: string }, { resourceId: string }> = {
  id: 'booking.resources.delete',
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Resource id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(BookingResource, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Booking resource not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
    return { resourceId: record.id }
  },
}

registerCommand(createResourceCommand)
registerCommand(updateResourceCommand)
registerCommand(deleteResourceCommand)
