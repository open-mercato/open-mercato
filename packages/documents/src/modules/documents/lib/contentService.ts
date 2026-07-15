import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { randomUUID } from 'node:crypto'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DocumentContent } from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from './constants'
import { nextDocumentVersion } from './versioning'
import { assertDocumentContentResourceLimits } from './resourceLimits'

const logger = createLogger('documents').child({ component: 'content-service' })

export type DocumentScope = {
  tenantId: string
  organizationId: string
}

export type DocumentContentSearchIndexer = {
  indexRecordById: (params: {
    entityId: string
    recordId: string
    tenantId: string
    organizationId?: string | null
  }) => Promise<unknown>
}

export type PersistDocumentContentDeps = {
  searchIndexer: DocumentContentSearchIndexer
  /**
   * Content version observed by the writer before it prepared this mutation.
   * When present, the comparison happens while holding the content-row lock.
   */
  expectedUpdatedAt?: string | Date
  /** Server-owned collaborative lineage observed when the room loaded. */
  expectedCollaborationGeneration?: number
  /** Sidecar CAS must remain active even if user-facing optimistic locks are disabled. */
  requireExpectedVersion?: boolean
}

export type PersistedDocumentContent = {
  id: string
  updatedAt: Date
  collaborationGeneration: number
}

export function normalizeDocumentCollaborationGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : null
}

export function advanceDocumentCollaborationGeneration(content: DocumentContent): number {
  const current = normalizeDocumentCollaborationGeneration(content.collaborationGeneration)
  if (current === null || current >= Number.MAX_SAFE_INTEGER) {
    throw new Error('[internal] document collaboration generation is invalid')
  }
  content.collaborationGeneration = current + 1
  return content.collaborationGeneration
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, token: string) => {
    const named = ENTITY_MAP[token.toLowerCase()]
    if (named) return named
    if (token.startsWith('#x') || token.startsWith('#X')) {
      const parsed = Number.parseInt(token.slice(2), 16)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match
    }
    if (token.startsWith('#')) {
      const parsed = Number.parseInt(token.slice(1), 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match
    }
    return match
  })
}

export function deriveContentTextFromHtml(contentHtml: string): string {
  return decodeHtmlEntities(
    contentHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

export async function loadDocumentContent(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
): Promise<DocumentContent | null> {
  return findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
}

/**
 * Read the exact collaboration state/version/generation tuple from an
 * isolated transaction. The short pessimistic read lock prevents observing a
 * partially completed authoritative reset while a room is being loaded or a
 * competing replica is reconciling after a CAS loss.
 */
export async function loadDocumentContentForCollaboration(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
): Promise<DocumentContent | null> {
  return em.fork().transactional((transactionalEm) => findOneWithDecryption(
    transactionalEm,
    DocumentContent,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_READ },
    scope,
  ))
}

/**
 * Lightweight active-room reconciliation probe. A missing row means the
 * scoped content was deleted; normal collaborative stores retain the same
 * generation while authoritative replacements advance it.
 */
export async function loadDocumentCollaborationGeneration(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
): Promise<number | null> {
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { fields: ['collaborationGeneration'] },
    scope,
  )
  if (!content) return null
  return normalizeDocumentCollaborationGeneration(content.collaborationGeneration)
}

export async function mutateDocumentContentState(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
  input: { yjsState?: Buffer | null; contentHtml?: string | null; contentText?: string | null },
  options: { id?: string; now?: Date; existingContent?: DocumentContent | null } = {},
): Promise<DocumentContent> {
  assertDocumentContentResourceLimits(input)
  let content = options.existingContent !== undefined
    ? options.existingContent
    : await findOneWithDecryption(
        em,
        DocumentContent,
        { documentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { filters: false },
        scope,
      )
  const requestedNow = options.now ?? new Date()
  const now = content ? nextDocumentVersion(content.updatedAt, requestedNow) : requestedNow
  if (!content) {
    content = em.create(DocumentContent, {
      id: options.id ?? randomUUID(),
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      contentHtml: '',
      contentText: '',
      collaborationGeneration: 1,
      updatedAt: now,
    })
    em.persist(content)
  } else if (options.id && content.id !== options.id) {
    throw new Error('[internal] document content identity does not match the prepared aggregate')
  }

  const hasContentHtml = Object.prototype.hasOwnProperty.call(input, 'contentHtml')
  const hasContentText = Object.prototype.hasOwnProperty.call(input, 'contentText')
  if (hasContentHtml) content.contentHtml = input.contentHtml ?? ''
  if (hasContentText) {
    content.contentText = input.contentText ?? deriveContentTextFromHtml(content.contentHtml ?? '')
  } else if (hasContentHtml) {
    content.contentText = deriveContentTextFromHtml(content.contentHtml ?? '')
  }
  if (Object.prototype.hasOwnProperty.call(input, 'yjsState')) {
    content.yjsState = input.yjsState ?? null
  }
  assertDocumentContentResourceLimits({
    yjsState: content.yjsState,
    contentHtml: content.contentHtml,
    contentText: content.contentText,
  })
  content.deletedAt = null
  content.updatedAt = now
  return content
}

export async function persistDocumentContent(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
  input: { yjsState?: Buffer | null; contentHtml?: string | null; contentText?: string | null },
  deps: PersistDocumentContentDeps,
): Promise<PersistedDocumentContent> {
  if (!deps.searchIndexer || typeof deps.searchIndexer.indexRecordById !== 'function') {
    throw new Error('[internal] documents content persistence requires searchIndexer')
  }

  // Collaboration stores must not reuse a request identity map: every attempt
  // gets a fresh EM, transaction, and row lock before checking both CAS axes.
  const persisted = await em.fork().transactional(async (transactionalEm) => {
    const current = await findOneWithDecryption(
      transactionalEm,
      DocumentContent,
      {
        documentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )

    if (deps.requireExpectedVersion && deps.expectedUpdatedAt === undefined) {
      throw new Error('[internal] documents content CAS requires an expected version')
    }
    if (
      deps.requireExpectedVersion
      && normalizeDocumentCollaborationGeneration(deps.expectedCollaborationGeneration) === null
    ) {
      throw new Error('[internal] documents content CAS requires an expected collaboration generation')
    }
    if (deps.expectedCollaborationGeneration !== undefined) {
      const currentGeneration = normalizeDocumentCollaborationGeneration(
        current?.collaborationGeneration,
      )
      if (currentGeneration === null || currentGeneration !== deps.expectedCollaborationGeneration) {
        throw new CrudHttpError(409, {
          error: 'Record changed by another user',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
          currentCollaborationGeneration: currentGeneration,
          expectedCollaborationGeneration: deps.expectedCollaborationGeneration,
        })
      }
    }
    if (deps.expectedUpdatedAt !== undefined) {
      if (!current) {
        throw new Error('[internal] documents content changed after the collaboration room loaded')
      }
      assertOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
        resourceId: current.id,
        current: current.updatedAt,
        expected: deps.expectedUpdatedAt,
        ...(deps.requireExpectedVersion ? { envValue: 'all' } : {}),
      })
    }

    const previousUpdatedAt = current?.updatedAt.getTime() ?? null
    const content = await mutateDocumentContentState(
      transactionalEm,
      documentId,
      scope,
      input,
      { existingContent: current },
    )
    await transactionalEm.flush()
    let persistedUpdatedAt = new Date(content.updatedAt.getTime())
    if (previousUpdatedAt !== null && persistedUpdatedAt.getTime() <= previousUpdatedAt) {
      persistedUpdatedAt = new Date(previousUpdatedAt + 1)
      const affected = await transactionalEm.nativeUpdate(
        DocumentContent,
        {
          id: content.id,
          documentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        { updatedAt: persistedUpdatedAt },
      )
      if (affected !== 1) {
        throw new Error('[internal] documents content version could not be advanced')
      }
      content.updatedAt = persistedUpdatedAt
    }
    const collaborationGeneration = normalizeDocumentCollaborationGeneration(
      content.collaborationGeneration,
    )
    if (collaborationGeneration === null) {
      throw new Error('[internal] document collaboration generation is invalid')
    }
    return { id: content.id, updatedAt: persistedUpdatedAt, collaborationGeneration }
  })

  try {
    await deps.searchIndexer.indexRecordById({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
  } catch (error) {
    // The content transaction is already committed. Search is a retryable
    // projection and must not make Hocuspocus retain a stale CAS token or tell
    // an HTTP caller that the canonical write failed.
    logger.error('Content search indexing failed after commit', {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      err: error,
    })
  }
  return persisted
}
