import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import {
  Document,
  DocumentAttachment,
  DocumentComment,
  DocumentContent,
  DocumentEntityLink,
  DocumentShare,
  DocumentVersion,
} from '../data/entities'
import type { DocumentsCommandScope } from './shared'

export async function lockDocumentAggregateRoot(
  em: EntityManager,
  documentId: string,
  scope: DocumentsCommandScope,
  options: { includeDeleted?: boolean } = {},
): Promise<Document> {
  const document = await findOneWithDecryption(
    em,
    Document,
    {
      id: documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      ...(options.includeDeleted ? { filters: false } : {}),
    },
    scope,
  )
  if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
  return document
}

export async function loadLockedDocumentContent(
  em: EntityManager,
  documentId: string,
  scope: DocumentsCommandScope,
  options: { includeDeleted?: boolean } = {},
): Promise<DocumentContent | null> {
  return findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
    {
      lockMode: LockMode.PESSIMISTIC_WRITE,
      ...(options.includeDeleted ? { filters: false } : {}),
    },
    scope,
  )
}

async function hasScopedRows<TEntity extends object>(
  em: EntityManager,
  entity: { new (...args: never[]): TEntity },
  where: Record<string, unknown>,
  scope: DocumentsCommandScope,
): Promise<boolean> {
  const rows = await findWithDecryption(
    em,
    entity,
    where,
    { limit: 1 },
    scope,
  )
  return rows.length > 0
}

export async function assertNoPostCreateDocumentDependents(
  em: EntityManager,
  documentId: string,
  scope: DocumentsCommandScope,
  options: { allowedLinkIds?: readonly string[]; allowedAttachmentIds?: readonly string[] } = {},
): Promise<void> {
  const base = {
    documentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  const links = await findWithDecryption(
    em,
    DocumentEntityLink,
    { ...base, deletedAt: null },
    undefined,
    scope,
  )
  const allowedLinkIds = new Set(options.allowedLinkIds ?? [])
  if (links.some((link) => !allowedLinkIds.has(link.id))) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }

  const attachments = await findWithDecryption(
    em,
    DocumentAttachment,
    { ...base, deletedAt: null },
    undefined,
    scope,
  )
  const allowedAttachmentIds = new Set(options.allowedAttachmentIds ?? [])
  if (attachments.some((attachment) => !allowedAttachmentIds.has(attachment.id))) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }

  // Keep dependent reads sequential on the transaction's single connection.
  // Every write path locks the parent document first, so the root lock closes
  // the check-then-delete window while these scoped probes run.
  if (
    await hasScopedRows(em, DocumentShare, { ...base, deletedAt: null }, scope)
    || await hasScopedRows(em, DocumentComment, { ...base, deletedAt: null }, scope)
    || await hasScopedRows(em, DocumentVersion, base, scope)
  ) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}
