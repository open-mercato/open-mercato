import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import {
  SalesNote,
  SalesOrder,
  SalesQuote,
  SalesInvoice,
  SalesCreditMemo,
  type SalesDocumentKind,
} from '../data/entities'
import {
  noteCreateSchema,
  noteUpdateSchema,
  type NoteCreateInput,
  type NoteUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureSameScope, ensureTenantScope, extractUndoPayload } from './shared'

type NoteSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  contextType: SalesDocumentKind
  contextId: string
  orderId: string | null
  quoteId: string | null
  body: string
  authorUserId: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
}

type NoteUndoPayload = {
  before?: NoteSnapshot | null
  after?: NoteSnapshot | null
}

const noteCrudIndexer = {
  entityType: E.sales.sales_note,
}

async function loadNoteSnapshot(em: EntityManager, id: string): Promise<NoteSnapshot | null> {
  const note = await em.findOne(SalesNote, { id })
  if (!note) return null
  return {
    id: note.id,
    organizationId: note.organizationId,
    tenantId: note.tenantId,
    contextType: note.contextType,
    contextId: note.contextId,
    orderId: note.order ? (typeof note.order === 'string' ? note.order : note.order.id) : null,
    quoteId: note.quote ? (typeof note.quote === 'string' ? note.quote : note.quote.id) : null,
    body: note.body,
    authorUserId: note.authorUserId ?? null,
    appearanceIcon: note.appearanceIcon ?? null,
    appearanceColor: note.appearanceColor ?? null,
  }
}

async function requireContext(
  em: EntityManager,
  contextType: SalesDocumentKind,
  contextId: string,
  organizationId?: string,
  tenantId?: string
): Promise<{
  organizationId: string
  tenantId: string
  order?: SalesOrder | null
  quote?: SalesQuote | null
}> {
  if (contextType === 'order') {
    const order = await em.findOne(SalesOrder, { id: contextId })
    if (!order) {
      throw new CrudHttpError(404, { error: 'sales.notes.context_not_found' })
    }
    if (organizationId && tenantId) {
      ensureSameScope(order, organizationId, tenantId)
    }
    return {
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      order,
      quote: null,
    }
  }
  if (contextType === 'quote') {
    const quote = await em.findOne(SalesQuote, { id: contextId })
    if (!quote) {
      throw new CrudHttpError(404, { error: 'sales.notes.context_not_found' })
    }
    if (organizationId && tenantId) {
      ensureSameScope(quote, organizationId, tenantId)
    }
    return {
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      order: null,
      quote,
    }
  }
  const repo = contextType === 'invoice' ? SalesInvoice : SalesCreditMemo
  const entity = await em.findOne(repo, { id: contextId })
  if (!entity) {
    throw new CrudHttpError(404, { error: 'sales.notes.context_not_found' })
  }
  if (organizationId && tenantId) {
    ensureSameScope(entity, organizationId, tenantId)
  }
  return {
    organizationId: entity.organizationId,
    tenantId: entity.tenantId,
    order: null,
    quote: null,
  }
}

function resolveAuthor(inputAuthor: string | undefined, authSub: string | null): string | null {
  if (inputAuthor) return inputAuthor
  if (!authSub) return null
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(authSub) ? authSub : null
}

const createNoteCommand: CommandHandler<NoteCreateInput, { noteId: string; authorUserId: string | null }> = {
  id: 'sales.notes.create',
  async execute(rawInput, ctx) {
    const parsed = noteCreateSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const context = await requireContext(em, parsed.contextType, parsed.contextId, parsed.organizationId, parsed.tenantId)
    const authorUserId = resolveAuthor(parsed.authorUserId, ctx.auth?.isApiKey ? null : ctx.auth?.sub ?? null)

    const note = em.create(SalesNote, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      contextType: parsed.contextType,
      contextId: parsed.contextId,
      order: context.order ?? null,
      quote: context.quote ?? null,
      authorUserId,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      body: parsed.body,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(note)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: note,
      identifiers: {
        id: note.id,
        organizationId: note.organizationId,
        tenantId: note.tenantId,
      },
      indexer: noteCrudIndexer,
    })

    return { noteId: note.id, authorUserId: note.authorUserId ?? null }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadNoteSnapshot(em, result.noteId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as NoteSnapshot | undefined
    return {
      actionLabel: translate('sales.audit.notes.create', 'Create note'),
      resourceKind: 'sales.note',
      resourceId: result.noteId,
      parentResourceKind: snapshot?.contextType ? `sales.${snapshot.contextType}` : null,
      parentResourceId: snapshot?.contextId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies NoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const noteId = logEntry?.resourceId ?? null
    if (!noteId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(SalesNote, { id: noteId })
    if (existing) {
      em.remove(existing)
      await em.flush()
    }
  },
}

const updateNoteCommand: CommandHandler<NoteUpdateInput, { noteId: string }> = {
  id: 'sales.notes.update',
  async prepare(rawInput, ctx) {
    const parsed = noteUpdateSchema.parse(rawInput ?? {})
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadNoteSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = noteUpdateSchema.parse(rawInput ?? {})
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const note = await em.findOne(SalesNote, { id: parsed.id })
    if (!note) throw new CrudHttpError(404, { error: 'sales.notes.not_found' })
    ensureTenantScope(ctx, note.tenantId)
    ensureOrganizationScope(ctx, note.organizationId)

    if (parsed.body !== undefined) note.body = parsed.body
    if (parsed.authorUserId !== undefined) note.authorUserId = parsed.authorUserId ?? null
    if (parsed.appearanceIcon !== undefined) note.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) note.appearanceColor = parsed.appearanceColor ?? null
    note.updatedAt = new Date()

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: note,
      identifiers: {
        id: note.id,
        organizationId: note.organizationId,
        tenantId: note.tenantId,
      },
      indexer: noteCrudIndexer,
    })

    return { noteId: note.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadNoteSnapshot(em, result.noteId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as NoteSnapshot | undefined
    if (!before) return null
    const after = snapshots.after as NoteSnapshot | undefined
    const changes =
      after && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            ['body', 'authorUserId', 'appearanceIcon', 'appearanceColor']
          )
        : {}
    return {
      actionLabel: translate('sales.audit.notes.update', 'Update note'),
      resourceKind: 'sales.note',
      resourceId: before.id,
      parentResourceKind: before.contextType ? `sales.${before.contextType}` : null,
      parentResourceId: before.contextId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: after ?? null,
        } satisfies NoteUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<NoteUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const context = await requireContext(em, before.contextType, before.contextId).catch(() => null)
    if (!context) return
    let note = await em.findOne(SalesNote, { id: before.id })
    if (!note) {
      note = em.create(SalesNote, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        contextType: before.contextType,
        contextId: before.contextId,
        order: before.orderId ? context.order ?? null : null,
        quote: before.quoteId ? context.quote ?? null : null,
        body: before.body,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(note)
    }
    note.organizationId = before.organizationId
    note.tenantId = before.tenantId
    note.contextType = before.contextType
    note.contextId = before.contextId
    note.order = before.orderId ? context.order ?? null : null
    note.quote = before.quoteId ? context.quote ?? null : null
    note.body = before.body
    note.authorUserId = before.authorUserId
    note.appearanceIcon = before.appearanceIcon
    note.appearanceColor = before.appearanceColor
    note.updatedAt = new Date()
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: note,
      identifiers: {
        id: note.id,
        organizationId: note.organizationId,
        tenantId: note.tenantId,
      },
      indexer: noteCrudIndexer,
    })
  },
}

const deleteNoteCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { noteId: string }> =
  {
    id: 'sales.notes.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Note id required')
      const em = ctx.container.resolve('em') as EntityManager
      const snapshot = await loadNoteSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Note id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const note = await em.findOne(SalesNote, { id })
      if (!note) throw new CrudHttpError(404, { error: 'sales.notes.not_found' })
      ensureTenantScope(ctx, note.tenantId)
      ensureOrganizationScope(ctx, note.organizationId)
      em.remove(note)
      await em.flush()

      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: note,
        identifiers: {
          id: note.id,
          organizationId: note.organizationId,
          tenantId: note.tenantId,
        },
        indexer: noteCrudIndexer,
      })
      return { noteId: note.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as NoteSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('sales.audit.notes.delete', 'Delete note'),
        resourceKind: 'sales.note',
        resourceId: before.id,
        parentResourceKind: before.contextType ? `sales.${before.contextType}` : null,
        parentResourceId: before.contextId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies NoteUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<NoteUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const context = await requireContext(em, before.contextType, before.contextId).catch(() => null)
      if (!context) return
    let note = await em.findOne(SalesNote, { id: before.id })
    if (!note) {
      note = em.create(SalesNote, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        contextType: before.contextType,
        contextId: before.contextId,
        order: before.orderId ? context.order ?? null : null,
        quote: before.quoteId ? context.quote ?? null : null,
        body: before.body,
        authorUserId: before.authorUserId,
        appearanceIcon: before.appearanceIcon,
        appearanceColor: before.appearanceColor,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(note)
    }
      note.organizationId = before.organizationId
      note.tenantId = before.tenantId
      note.contextType = before.contextType
      note.contextId = before.contextId
      note.order = before.orderId ? context.order ?? null : null
      note.quote = before.quoteId ? context.quote ?? null : null
      note.body = before.body
      note.authorUserId = before.authorUserId
      note.appearanceIcon = before.appearanceIcon
      note.appearanceColor = before.appearanceColor
      note.updatedAt = new Date()
      await em.flush()

      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'created',
        entity: note,
        identifiers: {
          id: note.id,
          organizationId: note.organizationId,
          tenantId: note.tenantId,
        },
        indexer: noteCrudIndexer,
      })
    },
  }

registerCommand(createNoteCommand)
registerCommand(updateNoteCommand)
registerCommand(deleteNoteCommand)
