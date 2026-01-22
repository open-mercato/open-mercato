import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'
import { ResourcesResourceTag, ResourcesResourceTagAssignment } from '../data/entities'
import {
  resourcesResourceTagCreateSchema,
  resourcesResourceTagUpdateSchema,
  type ResourcesResourceTagCreateInput,
  type ResourcesResourceTagUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const createTagCommand: CommandHandler<ResourcesResourceTagCreateInput, { tagId: string }> = {
  id: 'resources.resourceTags.create',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceTagCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const slug =
      typeof parsed.slug === 'string' && parsed.slug.trim().length
        ? parsed.slug.trim()
        : slugifyTagLabel(parsed.label)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const conflict = await em.findOne(ResourcesResourceTag, {
      slug,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    if (conflict) throw new CrudHttpError(409, { error: 'Tag slug already exists for this scope' })
    const tag = em.create(ResourcesResourceTag, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      slug,
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
      actionLabel: translate('resources.audit.resourceTags.create', 'Create resource tag'),
      resourceKind: 'resources.resourceTag',
      resourceId: result?.tagId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const updateTagCommand: CommandHandler<ResourcesResourceTagUpdateInput, { tagId: string }> = {
  id: 'resources.resourceTags.update',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceTagUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(ResourcesResourceTag, { id: parsed.id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)
    if (parsed.slug && parsed.slug !== tag.slug) {
      const conflict = await em.findOne(ResourcesResourceTag, {
        slug: parsed.slug,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      })
      if (conflict && conflict.id !== tag.id) {
        throw new CrudHttpError(409, { error: 'Tag slug already exists for this scope' })
      }
      tag.slug = parsed.slug
    }
    if (parsed.label !== undefined) tag.label = parsed.label
    if (parsed.color !== undefined) tag.color = parsed.color ?? null
    if (parsed.description !== undefined) tag.description = parsed.description ?? null
    await em.flush()
    return { tagId: tag.id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const tag = result?.tagId ? await em.findOne(ResourcesResourceTag, { id: result.tagId }) : null
    return {
      actionLabel: translate('resources.audit.resourceTags.update', 'Update resource tag'),
      resourceKind: 'resources.resourceTag',
      resourceId: result?.tagId ?? input?.id ?? null,
      tenantId: tag?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: tag?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

const deleteTagCommand: CommandHandler<{ id?: string }, { tagId: string }> = {
  id: 'resources.resourceTags.delete',
  async execute(input, ctx) {
    const id = typeof input?.id === 'string' ? input.id : null
    if (!id) throw new CrudHttpError(400, { error: 'Tag id is required' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(ResourcesResourceTag, { id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)
    await em.nativeDelete(ResourcesResourceTagAssignment, { tag: tag.id })
    em.remove(tag)
    await em.flush()
    return { tagId: id }
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('resources.audit.resourceTags.delete', 'Delete resource tag'),
      resourceKind: 'resources.resourceTag',
      resourceId: result?.tagId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    }
  },
}

registerCommand(createTagCommand)
registerCommand(updateTagCommand)
registerCommand(deleteTagCommand)
