import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BookingResourceTag, BookingResourceTagAssignment } from '../data/entities'
import {
  bookingResourceTagCreateSchema,
  bookingResourceTagUpdateSchema,
  type BookingResourceTagCreateInput,
  type BookingResourceTagUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createTagCommand: CommandHandler<BookingResourceTagCreateInput, { tagId: string }> = {
  id: 'booking.resourceTags.create',
  async execute(rawInput, ctx) {
    const parsed = bookingResourceTagCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const conflict = await em.findOne(BookingResourceTag, {
      slug: parsed.slug,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    if (conflict) throw new CrudHttpError(409, { error: 'Tag slug already exists for this scope' })
    const tag = em.create(BookingResourceTag, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      slug: parsed.slug,
      label: parsed.label,
      color: parsed.color ?? null,
      description: parsed.description ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await em.persistAndFlush(tag)
    return { tagId: tag.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTags.create', 'Create resource tag'),
      resourceKind: 'booking.resourceTag',
      resourceId: result?.tagId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateTagCommand: CommandHandler<BookingResourceTagUpdateInput, { tagId: string }> = {
  id: 'booking.resourceTags.update',
  async execute(rawInput, ctx) {
    const parsed = bookingResourceTagUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(BookingResourceTag, { id: parsed.id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, parsed.tenantId ?? tag.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId ?? tag.organizationId)
    if (parsed.slug && parsed.slug !== tag.slug) {
      const conflict = await em.findOne(BookingResourceTag, {
        slug: parsed.slug,
        organizationId: parsed.organizationId ?? tag.organizationId,
        tenantId: parsed.tenantId ?? tag.tenantId,
      })
      if (conflict && conflict.id !== tag.id) {
        throw new CrudHttpError(409, { error: 'Tag slug already exists for this scope' })
      }
      tag.slug = parsed.slug
    }
    if (parsed.label !== undefined) tag.label = parsed.label
    if (parsed.color !== undefined) tag.color = parsed.color ?? null
    if (parsed.description !== undefined) tag.description = parsed.description ?? null
    if (parsed.organizationId) tag.organizationId = parsed.organizationId
    if (parsed.tenantId) tag.tenantId = parsed.tenantId
    await em.flush()
    return { tagId: tag.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTags.update', 'Update resource tag'),
      resourceKind: 'booking.resourceTag',
      resourceId: result?.tagId ?? input?.id ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const deleteTagCommand: CommandHandler<{ id?: string }, { tagId: string }> = {
  id: 'booking.resourceTags.delete',
  async execute(input, ctx) {
    const id = typeof input?.id === 'string' ? input.id : null
    if (!id) throw new CrudHttpError(400, { error: 'Tag id is required' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(BookingResourceTag, { id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)
    await em.nativeDelete(BookingResourceTagAssignment, { tag: tag.id })
    em.remove(tag)
    await em.flush()
    return { tagId: id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.resourceTags.delete', 'Delete resource tag'),
      resourceKind: 'booking.resourceTag',
      resourceId: result?.tagId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createTagCommand)
registerCommand(updateTagCommand)
registerCommand(deleteTagCommand)
