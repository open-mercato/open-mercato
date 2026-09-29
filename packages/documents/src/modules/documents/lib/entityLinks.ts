import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DocumentEntityLink } from '../data/entities'
import type {
  DocumentEntityLinkCreateInput,
  DocumentEntityType,
} from '../data/validators'
import { sanitizeDocumentsDisplayLabel } from './displayLabels'
import { getEntityTokenFieldNames } from './entityRegistry'
import { DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT } from './resourceLimits'

export type DocumentEntityLinkScope = {
  tenantId: string
  organizationId: string
}

export type DocumentEntityLinkCanonicalTarget = {
  id: string
  label: string
  href: string
  values?: Record<string, string | null>
}

type LinkTargetFields = Pick<
  DocumentEntityLink,
  | 'customerEntityId'
  | 'customerKind'
  | 'dealId'
  | 'productId'
  | 'catalogOfferId'
  | 'quoteId'
  | 'salesOrderId'
  | 'linkedDocumentId'
>

export type DocumentEntityLinkCreateData = LinkTargetFields & {
  id: string
  documentId: string
  tenantId: string
  organizationId: string
  labelSnapshot: string
  hrefSnapshot: string
  source: DocumentEntityLinkCreateInput['source']
  createdByUserId: string
}

const EMPTY_TARGET: LinkTargetFields = {
  customerEntityId: null,
  customerKind: null,
  dealId: null,
  productId: null,
  catalogOfferId: null,
  quoteId: null,
  salesOrderId: null,
  linkedDocumentId: null,
}

function sanitizeDocumentEntityValue(value: unknown): string | null {
  const label = sanitizeDocumentsDisplayLabel(value)
  return label && label.length <= 10_000 ? label : null
}

export function buildDocumentEntityLinkTarget(
  entityType: DocumentEntityType,
  entityId: string,
): LinkTargetFields {
  const target = { ...EMPTY_TARGET }
  if (entityType === 'customer-person' || entityType === 'customer-company') {
    target.customerEntityId = entityId
    target.customerKind = entityType === 'customer-person' ? 'person' : 'company'
  } else if (entityType === 'deal') {
    target.dealId = entityId
  } else if (entityType === 'product') {
    target.productId = entityId
  } else if (entityType === 'catalog-offer') {
    target.catalogOfferId = entityId
  } else if (entityType === 'quote') {
    target.quoteId = entityId
  } else if (entityType === 'document') {
    target.linkedDocumentId = entityId
  } else {
    target.salesOrderId = entityId
  }
  return target
}

export function buildDocumentEntityLinkTargetWhere(
  entityType: DocumentEntityType,
  entityId: string,
): LinkTargetFields {
  return buildDocumentEntityLinkTarget(entityType, entityId)
}

export function getDocumentEntityLinkType(link: DocumentEntityLink): DocumentEntityType {
  if (link.customerEntityId) {
    return link.customerKind === 'company' ? 'customer-company' : 'customer-person'
  }
  if (link.dealId) return 'deal'
  if (link.productId) return 'product'
  if (link.catalogOfferId) return 'catalog-offer'
  if (link.quoteId) return 'quote'
  if (link.linkedDocumentId) return 'document'
  return 'sales-order'
}

export function getDocumentEntityLinkEntityId(link: DocumentEntityLink): string {
  return link.customerEntityId
    ?? link.dealId
    ?? link.productId
    ?? link.catalogOfferId
    ?? link.quoteId
    ?? link.linkedDocumentId
    ?? link.salesOrderId
    ?? ''
}

export function createDocumentEntityLinkData(input: {
  id: string
  documentId: string
  scope: DocumentEntityLinkScope
  actorUserId: string
  link: DocumentEntityLinkCreateInput
}): DocumentEntityLinkCreateData {
  const labelSnapshot = sanitizeDocumentsDisplayLabel(input.link.label)
  if (!labelSnapshot) {
    throw new Error('[internal] document entity link label crossed persistence without a readable label')
  }
  return {
    id: input.id,
    documentId: input.documentId,
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    labelSnapshot,
    hrefSnapshot: input.link.href,
    source: input.link.source,
    createdByUserId: input.actorUserId,
    ...buildDocumentEntityLinkTarget(input.link.entityType, input.link.entityId),
  }
}

export async function findDocumentEntityLinks(
  em: EntityManager,
  documentId: string,
  scope: DocumentEntityLinkScope,
  options: { withDeleted?: boolean } = {},
): Promise<DocumentEntityLink[]> {
  const links = await findWithDecryption(
    em,
    DocumentEntityLink,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(options.withDeleted ? {} : { deletedAt: null }),
    },
    options.withDeleted
      ? { orderBy: { createdAt: 'ASC' } }
      : {
          orderBy: { createdAt: 'ASC' },
          limit: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1,
        },
    scope,
  )
  if (!options.withDeleted) assertDocumentEntityLinkListWithinLimit(links)
  return links
}

export function assertDocumentEntityLinkListWithinLimit(
  links: readonly DocumentEntityLink[],
): void {
  if (links.length <= DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT) return
  throw new CrudHttpError(413, { error: 'documents.links.limitExceeded' })
}

/** Call only while holding the document aggregate lock. */
export async function assertDocumentEntityLinkCapacity(
  em: EntityManager,
  documentId: string,
  scope: DocumentEntityLinkScope,
): Promise<void> {
  const activeCount = await em.count(DocumentEntityLink, {
    documentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (activeCount < DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT) return
  throw new CrudHttpError(413, { error: 'documents.links.limitExceeded' })
}

export function serializeDocumentEntityLink(
  link: DocumentEntityLink,
  options: {
    canOpen: boolean
    restrictedLabel: string
    canonicalTarget?: DocumentEntityLinkCanonicalTarget
  },
): {
  id: string
  entityType: DocumentEntityType
  entityId: string | null
  label: string
  href: string | null
  canOpen: boolean
  source: string
  createdAt: string
  updatedAt: string
  values?: Record<string, string | null>
} {
  const entityType = getDocumentEntityLinkType(link)
  const restrictedLabel = sanitizeDocumentsDisplayLabel(options.restrictedLabel)
  const canonicalLabel = options.canonicalTarget
    ? sanitizeDocumentsDisplayLabel(options.canonicalTarget.label)
    : null
  const snapshotLabel = sanitizeDocumentsDisplayLabel(link.labelSnapshot)
  const canOpen = options.canOpen && (
    options.canonicalTarget ? Boolean(canonicalLabel) : Boolean(snapshotLabel)
  )
  const readableLabel = canOpen ? canonicalLabel ?? snapshotLabel : restrictedLabel
  if (!readableLabel) {
    throw new Error('[internal] document entity link serialization requires a readable fallback label')
  }
  const allowedValueFields = getEntityTokenFieldNames(entityType)
  const values = options.canonicalTarget?.values
    ? Object.fromEntries(Array.from(allowedValueFields, (field) => [
        field,
        sanitizeDocumentEntityValue(options.canonicalTarget?.values?.[field]),
      ]))
    : null
  const hasReadableValues = values
    ? Object.values(values).some((value) => value !== null)
    : false
  return {
    id: link.id,
    entityType,
    entityId: canOpen
      ? options.canonicalTarget?.id ?? getDocumentEntityLinkEntityId(link)
      : null,
    label: canOpen ? readableLabel : restrictedLabel ?? readableLabel,
    href: canOpen
      ? options.canonicalTarget?.href ?? link.hrefSnapshot
      : null,
    canOpen,
    source: link.source,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    ...(canOpen && hasReadableValues && values ? { values } : {}),
  }
}
