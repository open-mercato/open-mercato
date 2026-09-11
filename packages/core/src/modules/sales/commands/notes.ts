import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { makeCommentCommandSet } from '@open-mercato/shared/lib/commands/timeline'
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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from './shared'

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

const noteCrudIndexer = {
  entityType: E.sales.sales_note,
}

const noteCrudEvents: CrudEventsConfig = {
  module: 'sales',
  entity: 'note',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

async function loadNoteSnapshot(em: EntityManager, id: string): Promise<NoteSnapshot | null> {
  const note = await findOneWithDecryption(em, SalesNote, { id }, {})
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

/**
 * Resolves the document a note hangs off. Notes are the only timeline family with a
 * polymorphic parent: four document kinds, of which only orders and quotes are also
 * denormalized onto the row as FK columns.
 */
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
    const order = await findOneWithDecryption(em, SalesOrder, { id: contextId }, {}, { tenantId, organizationId })
    if (!order) throw notFound('sales.notes.context_not_found')
    if (organizationId && tenantId) ensureSameScope(order, organizationId, tenantId)
    return { organizationId: order.organizationId, tenantId: order.tenantId, order, quote: null }
  }
  if (contextType === 'quote') {
    const quote = await findOneWithDecryption(em, SalesQuote, { id: contextId }, {}, { tenantId, organizationId })
    if (!quote) throw notFound('sales.notes.context_not_found')
    if (organizationId && tenantId) ensureSameScope(quote, organizationId, tenantId)
    return { organizationId: quote.organizationId, tenantId: quote.tenantId, order: null, quote }
  }
  const repo = contextType === 'invoice' ? SalesInvoice : SalesCreditMemo
  const entity = await findOneWithDecryption(
    em,
    repo as any,
    { id: contextId },
    {},
    { tenantId, organizationId },
  ) as (SalesInvoice | SalesCreditMemo) | null
  if (!entity) throw notFound('sales.notes.context_not_found')
  if (organizationId && tenantId) ensureSameScope(entity, organizationId, tenantId)
  return { organizationId: entity.organizationId, tenantId: entity.tenantId, order: null, quote: null }
}

/** #3998: a note's author is always the authenticated actor, never request input. */
function resolveAuthor(authSub: string | null): string | null {
  const sub = authSub?.trim()
  if (!sub) return null
  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
  return uuidRegex.test(sub) ? sub : null
}

/** Only the denormalized FK the snapshot actually carried is reattached. */
function relationsFor(snapshot: NoteSnapshot, context: { order?: SalesOrder | null; quote?: SalesQuote | null }) {
  return {
    order: snapshot.orderId ? context.order ?? null : null,
    quote: snapshot.quoteId ? context.quote ?? null : null,
  }
}

const noteCommands = makeCommentCommandSet<SalesNote, NoteSnapshot, NoteCreateInput, NoteUpdateInput>({
  commandIds: {
    create: 'sales.notes.create',
    update: 'sales.notes.update',
    delete: 'sales.notes.delete',
  },
  resourceKind: 'sales.note',
  auditLabels: {
    create: ['sales.audit.notes.create', 'Create note'],
    update: ['sales.audit.notes.update', 'Update note'],
    delete: ['sales.audit.notes.delete', 'Delete note'],
  },
  // Deliberately narrow: context and denormalized relation columns are not audited.
  changeKeys: ['body', 'authorUserId', 'appearanceIcon', 'appearanceColor'],
  messages: { notFound: 'sales.notes.not_found', idRequired: 'Note id required' },
  entityClass: SalesNote,
  indexer: noteCrudIndexer,
  events: noteCrudEvents,
  schemas: { create: noteCreateSchema, update: noteUpdateSchema },

  loadSnapshot: (em, id) => loadNoteSnapshot(em, id),
  findRowForWrite: (em, id) => findOneWithDecryption(em, SalesNote, { id }, {}),
  findRowForRestore: ({ em, id, snapshot }) =>
    findOneWithDecryption(em, SalesNote, { id }, {}, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId }),

  seedFromSnapshot: (snapshot) => ({
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    contextType: snapshot.contextType,
    contextId: snapshot.contextId,
    body: snapshot.body,
    authorUserId: snapshot.authorUserId,
    appearanceIcon: snapshot.appearanceIcon,
    appearanceColor: snapshot.appearanceColor,
  }),
  assignFromSnapshot: (note, snapshot) => {
    note.organizationId = snapshot.organizationId
    note.tenantId = snapshot.tenantId
    note.contextType = snapshot.contextType
    note.contextId = snapshot.contextId
    note.body = snapshot.body
    note.authorUserId = snapshot.authorUserId
    note.appearanceIcon = snapshot.appearanceIcon
    note.appearanceColor = snapshot.appearanceColor
    note.updatedAt = new Date()
  },

  resolveParentForCreate: async ({ em, parsed, ctx }) => {
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const context = await requireContext(em, parsed.contextType, parsed.contextId, parsed.organizationId, parsed.tenantId)
    return {
      relations: { order: context.order ?? null, quote: context.quote ?? null },
      scope: { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    }
  },
  // A redo whose document no longer resolves fails loudly; an undo bails silently, since
  // the delete it reverses is moot once the parent document is gone.
  resolveParentForRestore: async ({ em, snapshot, kind }) => {
    const context = await requireContext(em, snapshot.contextType, snapshot.contextId).catch(() => null)
    if (!context) {
      if (kind === 'redo') throw notFound('sales.notes.context_not_found')
      return null
    }
    return relationsFor(snapshot, context)
  },
  resolveAuthorForCreate: ({ ctx }) => resolveAuthor(ctx.auth?.isApiKey ? null : ctx.auth?.sub ?? null),

  buildCreateData: ({ parsed, relations, authorUserId }) => ({
    organizationId: parsed.organizationId,
    tenantId: parsed.tenantId,
    contextType: parsed.contextType,
    contextId: parsed.contextId,
    ...relations,
    authorUserId,
    appearanceIcon: parsed.appearanceIcon ?? null,
    appearanceColor: parsed.appearanceColor ?? null,
    body: parsed.body,
  }),
  // #3998: supplying `authorUserId` re-derives the author from the caller's identity
  // rather than honouring the submitted value.
  applyUpdateFields: ({ entity, parsed, ctx }) => {
    if (parsed.body !== undefined) entity.body = parsed.body
    if (parsed.authorUserId !== undefined) {
      entity.authorUserId = resolveAuthor(ctx.auth?.isApiKey ? null : ctx.auth?.sub ?? null)
    }
    if (parsed.appearanceIcon !== undefined) entity.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) entity.appearanceColor = parsed.appearanceColor ?? null
    entity.updatedAt = new Date()
  },

  logMeta: ({ before, after }) => {
    const source = before ?? after
    return {
      parentResourceKind: source?.contextType ? `sales.${source.contextType}` : null,
      parentResourceId: source?.contextId ?? null,
    }
  },
  ensureRowInScope: (ctx, note) => {
    ensureTenantScope(ctx, note.tenantId)
    ensureOrganizationScope(ctx, note.organizationId)
  },
  resourceIdOf: (result) => (result as { noteId: string }).noteId,
  buildResult: {
    create: (note) => ({ noteId: note.id, authorUserId: note.authorUserId ?? null }),
    update: (note) => ({ noteId: note.id }),
    delete: (note) => ({ noteId: note.id }),
  },
})

registerCommand(noteCommands.create)
registerCommand(noteCommands.update)
registerCommand(noteCommands.delete)
