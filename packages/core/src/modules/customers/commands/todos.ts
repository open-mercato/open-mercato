import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerTodoLink } from '../data/entities'
import { todoLinkCreateSchema, type TodoLinkCreateInput } from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  ensureSameScope,
  extractUndoPayload,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type TodoLinkSnapshot = {
  id: string
  entityId: string
  organizationId: string
  tenantId: string
  todoId: string
  todoSource: string
  createdByUserId: string | null
}

type TodoLinkUndoPayload = {
  before?: TodoLinkSnapshot | null
}

async function loadTodoLinkSnapshot(em: EntityManager, id: string): Promise<TodoLinkSnapshot | null> {
  const link = await em.findOne(CustomerTodoLink, { id })
  if (!link) return null
  return {
    id: link.id,
    entityId: typeof link.entity === 'string' ? link.entity : link.entity.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    todoId: link.todoId,
    todoSource: link.todoSource,
    createdByUserId: link.createdByUserId ?? null,
  }
}

const linkTodoCommand: CommandHandler<TodoLinkCreateInput, { linkId: string }> = {
  id: 'customers.todos.link',
  async execute(rawInput, ctx) {
    const parsed = todoLinkCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = ctx.container.resolve<EntityManager>('em').fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const todoSource = parsed.todoSource ?? 'example:todo'
    const existing = await em.findOne(CustomerTodoLink, {
      entity,
      todoId: parsed.todoId,
      todoSource,
    })
    if (existing) throw new CrudHttpError(409, { error: 'Todo already linked' })

    const link = em.create(CustomerTodoLink, {
      entity,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      todoId: parsed.todoId,
      todoSource,
      createdByUserId: parsed.createdByUserId ?? null,
    })
    em.persist(link)
    await em.flush()

    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
    })

    return { linkId: link.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return await loadTodoLinkSnapshot(em, result.linkId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadTodoLinkSnapshot(em, result.linkId)
    return {
      actionLabel: translate('customers.audit.todos.link', 'Link todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          before: snapshot ?? null,
        } satisfies TodoLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TodoLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    await em.nativeDelete(CustomerTodoLink, { id: before.id })
  },
}

const unlinkTodoCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { linkId: string | null }> =
  {
    id: 'customers.todos.unlink',
    async prepare(input, ctx) {
      const id = requireId(input, 'Todo link id required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadTodoLinkSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Todo link id required')
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const link = await em.findOne(CustomerTodoLink, { id })
      if (!link) throw new CrudHttpError(404, { error: 'Todo link not found' })
      ensureTenantScope(ctx, link.tenantId)
      ensureOrganizationScope(ctx, link.organizationId)
      em.remove(link)
      await em.flush()

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: link,
        identifiers: {
          id: link.id,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        },
      })
      return { linkId: link.id ?? null }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as TodoLinkSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.todos.unlink', 'Unlink todo'),
        resourceKind: 'customers.todoLink',
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies TodoLinkUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<TodoLinkUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      let link = await em.findOne(CustomerTodoLink, { id: before.id })
      if (!link) {
        const entity = await requireCustomerEntity(em, before.entityId, undefined, 'Customer not found')
        ensureSameScope(entity, before.organizationId, before.tenantId)
        link = em.create(CustomerTodoLink, {
          id: before.id,
          entity,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          todoId: before.todoId,
          todoSource: before.todoSource,
          createdByUserId: before.createdByUserId,
        })
        em.persist(link)
        await em.flush()
      }

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: link,
        identifiers: {
          id: link.id,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        },
      })
    },
  }

registerCommand(linkTodoCommand)
registerCommand(unlinkTodoCommand)
