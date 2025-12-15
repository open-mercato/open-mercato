// @ts-nocheck

import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { SalesDocumentTag, SalesDocumentTagAssignment } from '../data/entities'
import { ensureTenantScope } from './shared'
import {
  salesTagCreateSchema,
  salesTagUpdateSchema,
  type SalesTagCreateInput,
  type SalesTagUpdateInput,
} from '../data/validators'

const createTagCommand: CommandHandler<SalesTagCreateInput, { tagId: string }> = {
  id: 'sales.tags.create',
  async execute(rawInput, ctx) {
    const parsed = salesTagCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const conflict = await em.findOne(SalesDocumentTag, {
      slug: parsed.slug,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    if (conflict) throw new CrudHttpError(409, { error: 'Tag slug already exists for this scope' })
    const tag = em.create(SalesDocumentTag, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      slug: parsed.slug,
      label: parsed.label,
      color: parsed.color ?? null,
      description: parsed.description ?? null,
    })
    await em.persistAndFlush(tag)
    return { tagId: tag.id }
  },
}

const updateTagCommand: CommandHandler<SalesTagUpdateInput, { tagId: string }> = {
  id: 'sales.tags.update',
  async execute(rawInput, ctx) {
    const parsed = salesTagUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(SalesDocumentTag, { id: parsed.id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, parsed.tenantId ?? tag.tenantId)
    if (parsed.slug && parsed.slug !== tag.slug) {
      const conflict = await em.findOne(SalesDocumentTag, {
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
}

const deleteTagCommand: CommandHandler<{ id?: string }, { tagId: string }> = {
  id: 'sales.tags.delete',
  async execute(input, ctx) {
    const id = typeof input?.id === 'string' ? input.id : null
    if (!id) throw new CrudHttpError(400, { error: 'Tag id is required' })
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(SalesDocumentTag, { id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, tag.tenantId)
    await em.nativeDelete(SalesDocumentTagAssignment, { tag: tag.id })
    em.remove(tag)
    await em.flush()
    return { tagId: id }
  },
}

registerCommand(createTagCommand)
registerCommand(updateTagCommand)
registerCommand(deleteTagCommand)
