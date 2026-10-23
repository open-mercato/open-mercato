import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Attachment,
  AttachmentDocumentExtraction,
  AttachmentDocumentSection,
  AttachmentPartition,
} from '../../data/entities'
import { assertAttachmentScopeInvariant, checkAttachmentAccess, isSuperAdminAuth } from '../access'
import {
  buildCitation,
  buildCitationRef,
  formatSectionLocator,
  normalizeAnchorPart,
  parseCitationRef,
} from './locator'
import {
  enqueueDocumentStructureExtraction,
  type DocumentStructureQueueContainer,
  type EnqueueDocumentStructureInput,
} from './queue'
import type {
  DocumentOcrMode,
  DocumentSectionKind,
  DocumentSectionSource,
  DocumentStructureEngineName,
  ExtractionSkipReason,
  ExtractionStatus,
} from './types'

export const ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY = 'attachmentDocumentStructureService'
export const DOCUMENT_SECTIONS_MAX_PAGE_SIZE = 100
export const DOCUMENT_SECTIONS_DEFAULT_PAGE_SIZE = 50
export const DOCUMENT_SECTION_MIN_CHARS = 100
export const DOCUMENT_SECTION_MAX_CHARS = 16000
export const DOCUMENT_SECTION_DEFAULT_CHARS = 4000
export const DOCUMENT_OUTLINE_MAX_DEPTH = 8
export const DOCUMENT_OUTLINE_DEFAULT_DEPTH = 4
export const DOCUMENT_NORMALIZED_TEXT_MAX_RANGE = 64 * 1024

const SERVICE_PRINCIPAL = 'attachments:document-structure-service'
const OUTLINE_EXCLUDED_KINDS: ReadonlySet<DocumentSectionKind> = new Set(['paragraph', 'list_item', 'table'])
const REUSABLE_STATUSES: ReadonlySet<ExtractionStatus> = new Set(['completed', 'partial', 'skipped'])
const SECTION_METADATA_FIELDS = [
  'id',
  'parentId',
  'ordinal',
  'depth',
  'kind',
  'numberLabel',
  'heading',
  'pageStart',
  'pageEnd',
  'anchorKey',
] as const
const EXTRACTION_SUMMARY_FIELDS = [
  'id',
  'attachmentId',
  'status',
  'engine',
  'engineVersion',
  'contentSha256',
  'skipReason',
  'pageCount',
  'sectionCount',
  'charCount',
  'ocrPageCount',
  'stats',
  'createdAt',
  'completedAt',
] as const

const uuidSchema = z.string().uuid()

type ExtractionField = (typeof EXTRACTION_SUMMARY_FIELDS)[number] | 'normalizedText'

export type DocumentStructureAccessScope = {
  tenantId: string | null
  organizationId: string | null
  auth?: AuthContext
}

export type DocumentExtractionSummary = {
  id: string
  status: ExtractionStatus
  engine: DocumentStructureEngineName
  engineVersion: number
  contentSha256: string
  pageCount: number | null
  sectionCount: number | null
  charCount: number | null
  ocrPageCount: number | null
  skipReason: ExtractionSkipReason | null
  completedAt: Date | null
}

export type DocumentOutlineNode = {
  id: string
  parentId: string | null
  kind: DocumentSectionKind
  numberLabel: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
  anchorKey: string
  childCount: number
}

export type DocumentStructure = {
  attachmentId: string
  extraction: DocumentExtractionSummary | null
  outline: DocumentOutlineNode[]
}

export type DocumentSection = {
  id: string
  parentId: string | null
  ordinal: number
  depth: number
  kind: DocumentSectionKind
  numberLabel: string | null
  heading: string | null
  headingPath: string[]
  text?: string
  textTruncated: boolean
  pageStart: number | null
  pageEnd: number | null
  charStart: number
  charEnd: number
  anchorKey: string
  citationRef: string
  locator: string
  citation: string
  source: DocumentSectionSource
  tokenEstimate: number
}

export type DocumentStructureStats = DocumentExtractionSummary & {
  attachmentId: string
  createdAt: Date
  stats: Record<string, unknown> | null
}

export type GetDocumentStructureInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
  maxDepth?: number
  includeOutline?: boolean
}

export type ListDocumentSectionsInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
  parentId?: string | null
  anchorKey?: string | null
  numberLabel?: string | null
  page?: number | null
  kinds?: DocumentSectionKind[] | null
  afterOrdinal?: number | null
  limit?: number
  includeText?: boolean
  includeDescendants?: boolean
  maxCharsPerSection?: number
}

export type ListDocumentSectionsResult = {
  extractionId: string
  items: DocumentSection[]
  nextCursor: number | null
}

export type GetDocumentSectionInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
  sectionId?: string | null
  anchorKey?: string | null
  numberLabel?: string | null
  includeText?: boolean
  maxChars?: number
}

export type ResolveDocumentCitationInput = {
  ref: string
  scope: DocumentStructureAccessScope
  includeText?: boolean
  maxChars?: number
}

export type ResolvedDocumentCitation = {
  attachmentId: string
  extractionId: string
  section: DocumentSection
}

export type RequestDocumentExtractionInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
  force?: boolean
  ocr?: DocumentOcrMode
  requestedByUserId?: string | null
}

export type RequestDocumentExtractionResult = {
  extractionId: string | null
  status: ExtractionStatus
  enqueued: boolean
  jobId: string | null
}

export type GetDocumentNormalizedTextInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
  charStart: number
  charEnd: number
}

export type GetDocumentStructureStatsInput = {
  attachmentId: string
  scope: DocumentStructureAccessScope
}

export interface AttachmentDocumentStructureService {
  getStructure(input: GetDocumentStructureInput): Promise<DocumentStructure | null>
  listSections(input: ListDocumentSectionsInput): Promise<ListDocumentSectionsResult | null>
  getSection(input: GetDocumentSectionInput): Promise<DocumentSection | null>
  resolveCitation(input: ResolveDocumentCitationInput): Promise<ResolvedDocumentCitation | null>
  requestExtraction(input: RequestDocumentExtractionInput): Promise<RequestDocumentExtractionResult | null>
  getNormalizedText(input: GetDocumentNormalizedTextInput): Promise<string | null>
  getStats(input: GetDocumentStructureStatsInput): Promise<DocumentStructureStats | null>
}

export type DocumentStructureEnqueue = (input: EnqueueDocumentStructureInput) => Promise<string>

export type AttachmentDocumentStructureServiceDeps = {
  em: EntityManager
  enqueue?: DocumentStructureEnqueue
  queueContainer?: DocumentStructureQueueContainer | null
}

type NormalizedScope = { tenantId: string | null; organizationId: string | null }

type AccessGrant = {
  attachment: Attachment
  scope: NormalizedScope
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function partitionMatchesScope(partition: AttachmentPartition, scope: NormalizedScope): boolean {
  const partitionTenantId = partition.tenantId ?? null
  const partitionOrganizationId = partition.organizationId ?? null
  if (partitionTenantId === null && partitionOrganizationId === null) return true
  if (partitionTenantId === null || partitionOrganizationId === null) return false
  return partitionTenantId === scope.tenantId && partitionOrganizationId === scope.organizationId
}

function resolvePrincipal(scope: DocumentStructureAccessScope, normalized: NormalizedScope): AuthContext {
  if (scope.auth !== undefined) return scope.auth
  return { sub: SERVICE_PRINCIPAL, tenantId: normalized.tenantId, orgId: normalized.organizationId }
}

function principalMatchesScope(principal: AuthContext, normalized: NormalizedScope): boolean {
  if (!principal) return false
  if (isSuperAdminAuth(principal)) return true
  return (principal.tenantId ?? null) === normalized.tenantId && (principal.orgId ?? null) === normalized.organizationId
}

function numberLabelCandidates(value: string): string[] {
  const normalized = normalizeAnchorPart(value)
  if (!normalized) return []
  const bare = normalized.replace(/^§\s*/, '')
  return Array.from(new Set([normalized, bare, `§${bare}`].filter((candidate) => candidate.length > 0)))
}

function toExtractionSummary(extraction: AttachmentDocumentExtraction): DocumentExtractionSummary {
  return {
    id: extraction.id,
    status: extraction.status,
    engine: extraction.engine,
    engineVersion: extraction.engineVersion,
    contentSha256: extraction.contentSha256,
    pageCount: extraction.pageCount ?? null,
    sectionCount: extraction.sectionCount ?? null,
    charCount: extraction.charCount ?? null,
    ocrPageCount: extraction.ocrPageCount ?? null,
    skipReason: extraction.skipReason ?? null,
    completedAt: extraction.completedAt ?? null,
  }
}

function toDocumentSection(
  section: AttachmentDocumentSection,
  options: { includeText: boolean; maxChars: number },
): DocumentSection {
  const fullText = section.text ?? ''
  const textTruncated = options.includeText && fullText.length > options.maxChars
  const pageStart = section.pageStart ?? null
  const pageEnd = section.pageEnd ?? pageStart
  const numberLabel = section.numberLabel ?? null
  const headingPath = Array.isArray(section.headingPath) ? section.headingPath : []
  const sectionReference = numberLabel ? normalizeAnchorPart(numberLabel) : null
  return {
    id: section.id,
    parentId: section.parentId ?? null,
    ordinal: section.ordinal,
    depth: section.depth,
    kind: section.kind,
    numberLabel,
    heading: section.heading ?? null,
    headingPath,
    ...(options.includeText ? { text: textTruncated ? fullText.slice(0, options.maxChars) : fullText } : {}),
    textTruncated,
    pageStart,
    pageEnd,
    charStart: section.charStart,
    charEnd: section.charEnd,
    anchorKey: section.anchorKey,
    citationRef: buildCitationRef({ attachmentId: section.attachmentId, anchorKey: section.anchorKey }),
    locator: formatSectionLocator({
      pageStart,
      pageEnd,
      section: sectionReference || null,
      charStart: section.charStart,
      charEnd: section.charEnd,
    }),
    citation: buildCitation({ numberLabel, heading: section.heading ?? null, pageStart, pageEnd }),
    source: section.source,
    tokenEstimate: section.tokenEstimate,
  }
}

export function createAttachmentDocumentStructureService(
  deps: AttachmentDocumentStructureServiceDeps,
): AttachmentDocumentStructureService {
  const { em } = deps
  const enqueue: DocumentStructureEnqueue =
    deps.enqueue ?? ((input) => enqueueDocumentStructureExtraction(deps.queueContainer ?? null, input))

  async function authorize(attachmentId: string, scope: DocumentStructureAccessScope): Promise<AccessGrant | null> {
    const normalized: NormalizedScope = {
      tenantId: normalizeScopeValue(scope.tenantId),
      organizationId: normalizeScopeValue(scope.organizationId),
    }
    assertAttachmentScopeInvariant(normalized)
    if (!uuidSchema.safeParse(attachmentId).success) return null
    const principal = resolvePrincipal(scope, normalized)
    if (!principalMatchesScope(principal, normalized)) return null
    const attachment = await findOneWithDecryption(
      em,
      Attachment,
      { id: attachmentId, tenantId: normalized.tenantId, organizationId: normalized.organizationId },
      undefined,
      normalized,
    )
    if (!attachment) return null
    const partition = await findOneWithDecryption(
      em,
      AttachmentPartition,
      { code: attachment.partitionCode },
      undefined,
      normalized,
    )
    if (!partition || !partitionMatchesScope(partition, normalized)) return null
    const access = checkAttachmentAccess(principal, attachment, partition, { requireAuthForPublic: true })
    if (!access.ok) return null
    return { attachment, scope: normalized }
  }

  async function findLiveExtraction(
    grant: AccessGrant,
    fields: ReadonlyArray<ExtractionField> = EXTRACTION_SUMMARY_FIELDS,
  ): Promise<AttachmentDocumentExtraction | null> {
    const extractions = await findWithDecryption(
      em,
      AttachmentDocumentExtraction,
      {
        attachmentId: grant.attachment.id,
        tenantId: grant.scope.tenantId,
        organizationId: grant.scope.organizationId,
        deletedAt: null,
      },
      { fields: [...fields], orderBy: { createdAt: 'desc' }, limit: 1 },
      grant.scope,
    )
    return extractions[0] ?? null
  }

  function sectionScope(grant: AccessGrant, extractionId: string) {
    return {
      extractionId,
      attachmentId: grant.attachment.id,
      tenantId: grant.scope.tenantId,
      organizationId: grant.scope.organizationId,
    }
  }

  async function findSection(
    grant: AccessGrant,
    extractionId: string,
    criteria: { sectionId?: string | null; anchorKey?: string | null; numberLabel?: string | null },
  ): Promise<AttachmentDocumentSection | null> {
    const where: Record<string, unknown> = sectionScope(grant, extractionId)
    if (criteria.sectionId) {
      if (!uuidSchema.safeParse(criteria.sectionId).success) return null
      where.id = criteria.sectionId
    } else if (criteria.anchorKey) {
      where.anchorKey = criteria.anchorKey
    } else if (criteria.numberLabel) {
      const candidates = numberLabelCandidates(criteria.numberLabel)
      if (candidates.length === 0) return null
      where.numberLabel = { $in: candidates }
    } else {
      return null
    }
    const sections = await findWithDecryption(
      em,
      AttachmentDocumentSection,
      where,
      { orderBy: { ordinal: 'asc' }, limit: 1 },
      grant.scope,
    )
    return sections[0] ?? null
  }

  async function resolveSubtreeBounds(
    grant: AccessGrant,
    extractionId: string,
    parentId: string,
  ): Promise<{ start: number; end: number | null } | null> {
    if (!uuidSchema.safeParse(parentId).success) return null
    const parents = await findWithDecryption(
      em,
      AttachmentDocumentSection,
      { ...sectionScope(grant, extractionId), id: parentId },
      { fields: ['id', 'ordinal', 'depth'], limit: 1 },
      grant.scope,
    )
    const parent = parents[0]
    if (!parent) return null
    const boundaries = await findWithDecryption(
      em,
      AttachmentDocumentSection,
      { ...sectionScope(grant, extractionId), ordinal: { $gt: parent.ordinal }, depth: { $lte: parent.depth } },
      { fields: ['id', 'ordinal'], orderBy: { ordinal: 'asc' }, limit: 1 },
      grant.scope,
    )
    return { start: parent.ordinal, end: boundaries[0]?.ordinal ?? null }
  }

  return {
    async getStructure(input) {
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant)
      if (!extraction) return { attachmentId: grant.attachment.id, extraction: null, outline: [] }
      const summary = toExtractionSummary(extraction)
      if (input.includeOutline === false) {
        return { attachmentId: grant.attachment.id, extraction: summary, outline: [] }
      }
      const maxDepth = clampInteger(input.maxDepth, 1, DOCUMENT_OUTLINE_MAX_DEPTH, DOCUMENT_OUTLINE_DEFAULT_DEPTH)
      const sections = await findWithDecryption(
        em,
        AttachmentDocumentSection,
        { ...sectionScope(grant, extraction.id), depth: { $lte: maxDepth } },
        { fields: [...SECTION_METADATA_FIELDS], orderBy: { ordinal: 'asc' } },
        grant.scope,
      )
      const childCounts = new Map<string, number>()
      for (const section of sections) {
        if (!section.parentId) continue
        childCounts.set(section.parentId, (childCounts.get(section.parentId) ?? 0) + 1)
      }
      const outline = sections
        .filter((section) => section.depth >= 1 && !OUTLINE_EXCLUDED_KINDS.has(section.kind))
        .map((section) => ({
          id: section.id,
          parentId: section.parentId ?? null,
          kind: section.kind,
          numberLabel: section.numberLabel ?? null,
          heading: section.heading ?? null,
          pageStart: section.pageStart ?? null,
          pageEnd: section.pageEnd ?? section.pageStart ?? null,
          anchorKey: section.anchorKey,
          childCount: childCounts.get(section.id) ?? 0,
        }))
      return { attachmentId: grant.attachment.id, extraction: summary, outline }
    },

    async listSections(input) {
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant, ['id'])
      if (!extraction) return null
      const limit = clampInteger(
        input.limit,
        1,
        DOCUMENT_SECTIONS_MAX_PAGE_SIZE,
        DOCUMENT_SECTIONS_DEFAULT_PAGE_SIZE,
      )
      const maxChars = clampInteger(
        input.maxCharsPerSection,
        DOCUMENT_SECTION_MIN_CHARS,
        DOCUMENT_SECTION_MAX_CHARS,
        DOCUMENT_SECTION_DEFAULT_CHARS,
      )
      const includeText = input.includeText !== false
      const empty: ListDocumentSectionsResult = { extractionId: extraction.id, items: [], nextCursor: null }
      const where: Record<string, unknown> = sectionScope(grant, extraction.id)
      const ordinalFilter: Record<string, number> = {}
      if (typeof input.afterOrdinal === 'number' && Number.isFinite(input.afterOrdinal)) {
        ordinalFilter.$gt = Math.floor(input.afterOrdinal)
      }
      if (input.parentId) {
        if (input.includeDescendants) {
          const bounds = await resolveSubtreeBounds(grant, extraction.id, input.parentId)
          if (!bounds) return empty
          ordinalFilter.$gt = Math.max(ordinalFilter.$gt ?? bounds.start, bounds.start)
          if (bounds.end !== null) ordinalFilter.$lt = bounds.end
        } else {
          if (!uuidSchema.safeParse(input.parentId).success) return empty
          where.parentId = input.parentId
        }
      }
      if (Object.keys(ordinalFilter).length > 0) where.ordinal = ordinalFilter
      if (input.anchorKey) where.anchorKey = input.anchorKey
      if (input.numberLabel) {
        const candidates = numberLabelCandidates(input.numberLabel)
        if (candidates.length === 0) return empty
        where.numberLabel = { $in: candidates }
      }
      if (typeof input.page === 'number' && Number.isFinite(input.page)) {
        const page = Math.floor(input.page)
        where.pageStart = { $lte: page }
        where.pageEnd = { $gte: page }
      }
      if (input.kinds && input.kinds.length > 0) where.kind = { $in: [...input.kinds] }
      const rows = await findWithDecryption(
        em,
        AttachmentDocumentSection,
        where,
        { orderBy: { ordinal: 'asc' }, limit: limit + 1 },
        grant.scope,
      )
      const page = rows.slice(0, limit)
      const items = page.map((section) => toDocumentSection(section, { includeText, maxChars }))
      const nextCursor = rows.length > limit && page.length > 0 ? page[page.length - 1].ordinal : null
      return { extractionId: extraction.id, items, nextCursor }
    },

    async getSection(input) {
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant, ['id'])
      if (!extraction) return null
      const section = await findSection(grant, extraction.id, input)
      if (!section) return null
      return toDocumentSection(section, {
        includeText: input.includeText !== false,
        maxChars: clampInteger(input.maxChars, DOCUMENT_SECTION_MIN_CHARS, DOCUMENT_SECTION_MAX_CHARS, DOCUMENT_SECTION_DEFAULT_CHARS),
      })
    },

    async resolveCitation(input) {
      const parsed = parseCitationRef(input.ref)
      if (!parsed) return null
      const grant = await authorize(parsed.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant, ['id'])
      if (!extraction) return null
      const section = await findSection(grant, extraction.id, { anchorKey: parsed.anchorKey })
      if (!section) return null
      return {
        attachmentId: grant.attachment.id,
        extractionId: extraction.id,
        section: toDocumentSection(section, {
          includeText: input.includeText !== false,
          maxChars: clampInteger(input.maxChars, DOCUMENT_SECTION_MIN_CHARS, DOCUMENT_SECTION_MAX_CHARS, DOCUMENT_SECTION_DEFAULT_CHARS),
        }),
      }
    },

    async requestExtraction(input) {
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      if (!input.force) {
        const live = await findLiveExtraction(grant, ['id', 'status'])
        if (live && REUSABLE_STATUSES.has(live.status)) {
          return { extractionId: live.id, status: live.status, enqueued: false, jobId: null }
        }
      }
      const jobId = await enqueue({
        attachmentId: grant.attachment.id,
        tenantId: grant.scope.tenantId,
        organizationId: grant.scope.organizationId,
        force: input.force === true,
        ...(input.ocr ? { ocr: input.ocr } : {}),
        requestedByUserId: input.requestedByUserId ?? null,
      })
      return { extractionId: null, status: 'pending', enqueued: true, jobId }
    },

    async getNormalizedText(input) {
      if (!Number.isInteger(input.charStart) || !Number.isInteger(input.charEnd)) return null
      if (input.charStart < 0 || input.charEnd < input.charStart) return null
      if (input.charEnd - input.charStart > DOCUMENT_NORMALIZED_TEXT_MAX_RANGE) return null
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant, ['id', 'normalizedText'])
      if (!extraction || typeof extraction.normalizedText !== 'string') return null
      if (input.charEnd > extraction.normalizedText.length) return null
      return extraction.normalizedText.slice(input.charStart, input.charEnd)
    },

    async getStats(input) {
      const grant = await authorize(input.attachmentId, input.scope)
      if (!grant) return null
      const extraction = await findLiveExtraction(grant)
      if (!extraction) return null
      return {
        ...toExtractionSummary(extraction),
        attachmentId: grant.attachment.id,
        createdAt: extraction.createdAt,
        stats: extraction.stats ?? null,
      }
    },
  }
}
