import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerSavedView } from '../data/entities'
import {
  savedViewCreateSchema,
  savedViewUpdateSchema,
  type SavedViewCreateInput,
  type SavedViewUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'

const SAVED_VIEW_ENTITY_ID = 'customers:customer_saved_view'

const savedViewCrudIndexer: CrudIndexerConfig<CustomerSavedView> = {
  entityType: SAVED_VIEW_ENTITY_ID,
}

const savedViewCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'saved-view',
  persistent: false,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type SavedViewSnapshot = {
  view: {
    id: string
    organizationId: string
    tenantId: string
    userId: string
    entityType: string
    name: string
    filters: Record<string, unknown>
    sortField: string | null
    sortDir: string | null
    columns: string[] | null
    isDefault: boolean
    isShared: boolean
  }
}

type SavedViewUndoPayload = {
  before?: SavedViewSnapshot | null
  after?: SavedViewSnapshot | null
}

function buildSnapshot(view: CustomerSavedView): SavedViewSnapshot {
  return {
    view: {
      id: view.id,
      organizationId: view.organizationId,
      tenantId: view.tenantId,
      userId: view.userId,
      entityType: view.entityType,
      name: view.name,
      filters: view.filters ?? {},
      sortField: view.sortField ?? null,
      sortDir: view.sortDir ?? null,
      columns: view.columns ?? null,
      isDefault: view.isDefault,
      isShared: view.isShared,
    },
  }
}

async function loadSavedViewSnapshot(em: EntityManager, id: string): Promise<SavedViewSnapshot | null> {
  const view = await em.findOne(CustomerSavedView, { id, deletedAt: null })
  if (!view) return null
  return buildSnapshot(view)
}

const createSavedViewCommand: CommandHandler<SavedViewCreateInput, { savedViewId: string }> = {
  id: 'customers.saved-view.create',
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(savedViewCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (parsed.isDefault) {
      await em.nativeUpdate(
        CustomerSavedView,
        {
          organizationId: parsed.organizationId,
          tenantId: parsed.tenantId,
          userId: ctx.userId!,
          entityType: parsed.entityType,
          isDefault: true,
          deletedAt: null,
        },
        { isDefault: false }
      )
    }

    const view = em.create(CustomerSavedView, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      userId: ctx.userId!,
      entityType: parsed.entityType,
      name: parsed.name,
      filters: parsed.filters ?? {},
      sortField: parsed.sortField ?? null,
      sortDir: parsed.sortDir ?? null,
      columns: parsed.columns ?? null,
      isDefault: parsed.isDefault ?? false,
      isShared: parsed.isShared ?? false,
    })
    em.persist(view)
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: view,
      identifiers: {
        id: view.id,
        organizationId: view.organizationId,
        tenantId: view.tenantId,
      },
      indexer: savedViewCrudIndexer,
      events: savedViewCrudEvents,
    })

    return { savedViewId: view.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadSavedViewSnapshot(em, result.savedViewId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as SavedViewSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.saved_views.create', 'Create saved view'),
      resourceKind: 'customers.saved_view',
      resourceId: result.savedViewId,
      tenantId: snapshot?.view.tenantId ?? null,
      organizationId: snapshot?.view.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies SavedViewUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const viewId = logEntry?.resourceId
    if (!viewId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const view = await em.findOne(CustomerSavedView, { id: viewId })
    if (!view) return
    em.remove(view)
    await em.flush()
  },
}

const updateSavedViewCommand: CommandHandler<SavedViewUpdateInput, { savedViewId: string }> = {
  id: 'customers.saved-view.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(savedViewUpdateSchema, rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSavedViewSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(savedViewUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const view = await em.findOne(CustomerSavedView, { id: parsed.id, deletedAt: null })
    if (!view) throw new CrudHttpError(404, { error: 'Saved view not found' })
    ensureTenantScope(ctx, view.tenantId)
    ensureOrganizationScope(ctx, view.organizationId)

    if (parsed.isDefault && !view.isDefault) {
      await em.nativeUpdate(
        CustomerSavedView,
        {
          organizationId: view.organizationId,
          tenantId: view.tenantId,
          userId: view.userId,
          entityType: view.entityType,
          isDefault: true,
          deletedAt: null,
        },
        { isDefault: false }
      )
    }

    if (parsed.name !== undefined) view.name = parsed.name
    if (parsed.entityType !== undefined) view.entityType = parsed.entityType
    if (parsed.filters !== undefined) view.filters = parsed.filters ?? {}
    if (parsed.sortField !== undefined) view.sortField = parsed.sortField ?? null
    if (parsed.sortDir !== undefined) view.sortDir = parsed.sortDir ?? null
    if (parsed.columns !== undefined) view.columns = parsed.columns ?? null
    if (parsed.isDefault !== undefined) view.isDefault = parsed.isDefault
    if (parsed.isShared !== undefined) view.isShared = parsed.isShared

    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: view,
      identifiers: {
        id: view.id,
        organizationId: view.organizationId,
        tenantId: view.tenantId,
      },
      indexer: savedViewCrudIndexer,
      events: savedViewCrudEvents,
    })

    return { savedViewId: view.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadSavedViewSnapshot(em, result.savedViewId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SavedViewSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as SavedViewSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.saved_views.update', 'Update saved view'),
      resourceKind: 'customers.saved_view',
      resourceId: before.view.id,
      tenantId: before.view.tenantId,
      organizationId: before.view.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies SavedViewUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SavedViewUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let view = await em.findOne(CustomerSavedView, { id: before.view.id })
    if (!view) {
      view = em.create(CustomerSavedView, {
        id: before.view.id,
        organizationId: before.view.organizationId,
        tenantId: before.view.tenantId,
        userId: before.view.userId,
        entityType: before.view.entityType,
        name: before.view.name,
        filters: before.view.filters,
        sortField: before.view.sortField,
        sortDir: before.view.sortDir,
        columns: before.view.columns,
        isDefault: before.view.isDefault,
        isShared: before.view.isShared,
      })
      em.persist(view)
    } else {
      view.name = before.view.name
      view.entityType = before.view.entityType
      view.filters = before.view.filters
      view.sortField = before.view.sortField
      view.sortDir = before.view.sortDir
      view.columns = before.view.columns
      view.isDefault = before.view.isDefault
      view.isShared = before.view.isShared
    }
    await em.flush()

    const de = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: view,
      identifiers: {
        id: view.id,
        organizationId: view.organizationId,
        tenantId: view.tenantId,
      },
      indexer: savedViewCrudIndexer,
      events: savedViewCrudEvents,
    })
  },
}

const deleteSavedViewCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { savedViewId: string }> =
  {
    id: 'customers.saved-view.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Saved view id required')
      const em = ctx.container.resolve('em') as EntityManager
      const snapshot = await loadSavedViewSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Saved view id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const view = await em.findOne(CustomerSavedView, { id, deletedAt: null })
      if (!view) throw new CrudHttpError(404, { error: 'Saved view not found' })
      ensureTenantScope(ctx, view.tenantId)
      ensureOrganizationScope(ctx, view.organizationId)

      em.remove(view)
      await em.flush()

      const de = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: view,
        identifiers: {
          id: view.id,
          organizationId: view.organizationId,
          tenantId: view.tenantId,
        },
        indexer: savedViewCrudIndexer,
        events: savedViewCrudEvents,
      })

      return { savedViewId: view.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as SavedViewSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.saved_views.delete', 'Delete saved view'),
        resourceKind: 'customers.saved_view',
        resourceId: before.view.id,
        tenantId: before.view.tenantId,
        organizationId: before.view.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies SavedViewUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<SavedViewUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let view = await em.findOne(CustomerSavedView, { id: before.view.id })
      if (!view) {
        view = em.create(CustomerSavedView, {
          id: before.view.id,
          organizationId: before.view.organizationId,
          tenantId: before.view.tenantId,
          userId: before.view.userId,
          entityType: before.view.entityType,
          name: before.view.name,
          filters: before.view.filters,
          sortField: before.view.sortField,
          sortDir: before.view.sortDir,
          columns: before.view.columns,
          isDefault: before.view.isDefault,
          isShared: before.view.isShared,
        })
        em.persist(view)
      }
      await em.flush()

      const de = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: view,
        identifiers: {
          id: view.id,
          organizationId: view.organizationId,
          tenantId: view.tenantId,
        },
        indexer: savedViewCrudIndexer,
        events: savedViewCrudEvents,
      })
    },
  }

registerCommand(createSavedViewCommand)
registerCommand(updateSavedViewCommand)
registerCommand(deleteSavedViewCommand)

export { createSavedViewCommand, updateSavedViewCommand, deleteSavedViewCommand }
