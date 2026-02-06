import { registerCommand, commandRegistry } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerTodoLink } from '../data/entities'
import { z } from 'zod'
import {
  todoLinkWithTodoCreateSchema,
  type TodoLinkWithTodoCreateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireCustomerEntity,
  ensureSameScope,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'

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
  link?: TodoLinkSnapshot | null
}

type TodoCreateUndoPayload = {
  link?: TodoLinkSnapshot | null
  todo?: Record<string, unknown> | null
  delegateCommandId?: string | null
}

const unlinkSchema = z.object({
  linkId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const todoCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'todo',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type UnlinkInput = z.infer<typeof unlinkSchema>

function captureLinkSnapshot(link: CustomerTodoLink): TodoLinkSnapshot {
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

const unlinkTodoCommand: CommandHandler<UnlinkInput, { linkId: string }> = {
  id: 'customers.todos.unlink',
  async prepare(rawInput, ctx) {
    const parsed = unlinkSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const link = await em.findOne(CustomerTodoLink, { id: parsed.linkId })
    if (!link) return {}
    return { before: captureLinkSnapshot(link) }
  },
  async execute(rawInput, ctx) {
    const parsed = unlinkSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(CustomerTodoLink, { id: parsed.linkId })
    if (!link) throw new CrudHttpError(404, { error: 'Todo link not found' })
    ensureSameScope({ organizationId: link.organizationId, tenantId: link.tenantId }, parsed.organizationId, parsed.tenantId)

    em.remove(link)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: todoCrudEvents,
    })

    return { linkId: link.id }
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const parsed = unlinkSchema.parse(input)
    const before = snapshots.before as TodoLinkSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.todos.unlink', 'Unlink todo'),
      resourceKind: 'customers.todoLink',
      resourceId: parsed.linkId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          link: before ?? null,
        } satisfies TodoLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TodoLinkUndoPayload>(logEntry)
    const linkSnapshot = payload?.link
    if (!linkSnapshot) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(CustomerTodoLink, { id: linkSnapshot.id })
    if (existing) return

    const entity = await requireCustomerEntity(em, linkSnapshot.entityId, undefined, 'Customer not found')
    const link = em.create(CustomerTodoLink, {
      id: linkSnapshot.id,
      entity,
      organizationId: linkSnapshot.organizationId,
      tenantId: linkSnapshot.tenantId,
      todoId: linkSnapshot.todoId,
      todoSource: linkSnapshot.todoSource,
      createdByUserId: linkSnapshot.createdByUserId,
    })
    em.persist(link)
    await em.flush()
  },
}

const createTodoCommand: CommandHandler<TodoLinkWithTodoCreateInput, { linkId: string; todoId: string }> = {
  id: 'customers.todos.create',
  async execute(rawInput, ctx) {
    const parsed = todoLinkWithTodoCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const delegateCommandId = `${parsed.todoSource.split(':')[0]}.todos.create`
    const delegateHandler = commandRegistry.get(delegateCommandId)
    if (!delegateHandler) {
      throw new CrudHttpError(400, { error: `Todo source ${parsed.todoSource} is not supported` })
    }

    const todoPayload = {
      title: parsed.title,
      is_done: parsed.is_done ?? parsed.isDone ?? false,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      custom: parsed.todoCustom ?? parsed.custom ?? {},
    }

    const todoResult = await delegateHandler.execute(todoPayload, ctx) as { id: string }
    const todoId = todoResult.id

    const link = em.create(CustomerTodoLink, {
      entity,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      todoId,
      todoSource: parsed.todoSource,
      createdByUserId: ctx.auth?.sub ?? null,
    })
    em.persist(link)
    await em.flush()

    return { linkId: link.id, todoId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const link = await em.findOne(CustomerTodoLink, { id: result.linkId })
    if (!link) return null
    return captureLinkSnapshot(link)
  },
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const parsed = todoLinkWithTodoCreateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager)
    const link = await em.findOne(CustomerTodoLink, { id: result.linkId })
    const linkSnapshot = link ? captureLinkSnapshot(link) : null

    const delegateCommandId = `${parsed.todoSource.split(':')[0]}.todos.create`
    const delegateHandler = commandRegistry.get(delegateCommandId)
    let todoSnapshot: Record<string, unknown> | null = null
    if (delegateHandler?.captureAfter) {
      todoSnapshot = await delegateHandler.captureAfter(input, { id: result.todoId }, ctx) as Record<string, unknown> | null
    }

    return {
      actionLabel: translate('customers.audit.todos.create', 'Create todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          link: linkSnapshot,
          todo: todoSnapshot,
          delegateCommandId,
        } satisfies TodoCreateUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TodoCreateUndoPayload>(logEntry)
    if (!payload) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (payload.link) {
      await em.nativeDelete(CustomerTodoLink, { id: payload.link.id })
    }

    if (payload.delegateCommandId && payload.todo) {
      const delegateHandler = commandRegistry.get(payload.delegateCommandId)
      if (delegateHandler?.undo) {
        await delegateHandler.undo({
          input: undefined,
          ctx,
          logEntry: {
            commandPayload: { undo: { after: payload.todo } },
          } as any,
        })
      }
    }
  },
}

registerCommand(unlinkTodoCommand)
registerCommand(createTodoCommand)
