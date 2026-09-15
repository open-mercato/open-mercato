import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type {
  Document,
  DocumentContent,
  DocumentEntityLink,
  DocumentVersion,
} from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { resolveDocumentsCommandActor } from './shared'

type MutationAction = 'created' | 'updated' | 'deleted'

export async function bufferDocumentMutationSideEffects(
  ctx: CommandRuntimeContext,
  action: MutationAction,
  document: Document,
  options: { undo?: boolean } = {},
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const emit = options.undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine,
    action,
    entity: document,
    identifiers: {
      id: document.id,
      tenantId: document.tenantId,
      organizationId: document.organizationId,
    },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.document },
    events: {
      module: 'documents',
      entity: 'document',
      buildPayload: () => ({
        id: document.id,
        tenantId: document.tenantId,
        organizationId: document.organizationId,
        userId: resolveDocumentsCommandActor(ctx),
      }),
    },
  })
}

export async function bufferLinkMutationSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'deleted',
  link: DocumentEntityLink,
  options: {
    undo?: boolean
    entityType?: string
    entityId?: string
  } = {},
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const emit = options.undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine,
    action,
    entity: link,
    identifiers: {
      id: link.id,
      tenantId: link.tenantId,
      organizationId: link.organizationId,
    },
    events: {
      module: 'documents',
      entity: 'link',
      buildPayload: () => ({
        id: link.id,
        documentId: link.documentId,
        ...(options.entityType ? { entityType: options.entityType } : {}),
        ...(options.entityId ? { entityId: options.entityId } : {}),
        tenantId: link.tenantId,
        organizationId: link.organizationId,
        userId: resolveDocumentsCommandActor(ctx),
      }),
    },
  })
}

export async function bufferDocumentIndexRefresh(
  ctx: CommandRuntimeContext,
  content: DocumentContent,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: content,
    identifiers: {
      id: content.documentId,
      tenantId: content.tenantId,
      organizationId: content.organizationId,
    },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.document },
  })
}

export async function bufferVersionCreatedSideEffect(
  ctx: CommandRuntimeContext,
  version: DocumentVersion,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action: 'created',
    entity: version,
    identifiers: {
      id: version.id,
      tenantId: version.tenantId,
      organizationId: version.organizationId,
    },
    events: {
      module: 'documents',
      entity: 'version',
      buildPayload: () => ({
        id: version.id,
        documentId: version.documentId,
        tenantId: version.tenantId,
        organizationId: version.organizationId,
        userId: resolveDocumentsCommandActor(ctx),
      }),
    },
  })
}
