import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentContent } from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from './constants'

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
  return await em.findOne(DocumentContent, {
    documentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

export async function persistDocumentContent(
  em: EntityManager,
  documentId: string,
  scope: DocumentScope,
  input: { yjsState?: Buffer | null; contentHtml: string; contentText: string },
  deps: PersistDocumentContentDeps,
): Promise<void> {
  if (!deps.searchIndexer || typeof deps.searchIndexer.indexRecordById !== 'function') {
    throw new Error('[internal] documents content persistence requires searchIndexer')
  }

  let content = await loadDocumentContent(em, documentId, scope)
  const now = new Date()
  if (!content) {
    content = em.create(DocumentContent, {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      contentHtml: '',
      contentText: '',
      updatedAt: now,
    })
    em.persist(content)
  }

  content.contentHtml = input.contentHtml
  content.contentText = input.contentText || deriveContentTextFromHtml(input.contentHtml)
  if (Object.prototype.hasOwnProperty.call(input, 'yjsState')) {
    content.yjsState = input.yjsState ?? null
  }
  content.deletedAt = null
  content.updatedAt = now

  await em.flush()
  await deps.searchIndexer.indexRecordById({
    entityId: DOCUMENTS_ENTITY_IDS.document,
    recordId: documentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
}
