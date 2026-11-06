import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildCitation, DOCUMENT_HEADING_PATH_SEPARATOR } from './lib/documentStructure/locator'

const logger = createLogger('attachments')

export const DOCUMENT_SECTION_SEARCH_ENTITY_ID = 'attachments:attachment_document_section'
const DOCUMENT_EXTRACTION_ENTITY_ID = 'attachments:attachment_document_extraction'
const PARTITION_ENTITY_ID = 'attachments:attachment_partition'
const ATTACHMENT_ENTITY_ID = 'attachments:attachment'
export const DOCUMENT_SECTION_SEARCH_URL = '/backend/storage/attachments'
const SECTION_ICON = 'file-text'

type ScopedSearchContext = {
  tenantId: string
  organizationId: string | null
  queryEngine: QueryEngine
}

type SectionRecord = {
  extractionId: string | null
  attachmentId: string | null
  numberLabel: string | null
  heading: string | null
  headingPath: string[]
  text: string | null
  pageStart: number | null
  pageEnd: number | null
  textSha256: string | null
}

function pick(record: Record<string, unknown>, snakeKey: string, camelKey: string): unknown {
  return record[snakeKey] ?? record[camelKey]
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = pick(record, snakeKey, camelKey)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readInteger(record: Record<string, unknown>, snakeKey: string, camelKey: string): number | null {
  const value = pick(record, snakeKey, camelKey)
  const numeric = typeof value === 'string' && value.trim().length ? Number(value) : value
  return typeof numeric === 'number' && Number.isInteger(numeric) ? numeric : null
}

function readHeadingPath(record: Record<string, unknown>): string[] {
  let value = pick(record, 'heading_path', 'headingPath')
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function readSection(record: Record<string, unknown>): SectionRecord {
  return {
    extractionId: readString(record, 'extraction_id', 'extractionId'),
    attachmentId: readString(record, 'attachment_id', 'attachmentId'),
    numberLabel: readString(record, 'number_label', 'numberLabel'),
    heading: readString(record, 'heading', 'heading'),
    headingPath: readHeadingPath(record),
    text: readString(record, 'text', 'text'),
    pageStart: readInteger(record, 'page_start', 'pageStart'),
    pageEnd: readInteger(record, 'page_end', 'pageEnd'),
    textSha256: readString(record, 'text_sha256', 'textSha256'),
  }
}

function isQueryEngine(value: unknown): value is QueryEngine {
  return typeof value === 'object' && value !== null && typeof (value as { query?: unknown }).query === 'function'
}

function resolveScope(ctx: SearchBuildContext): ScopedSearchContext | null {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) return null
  if (!isQueryEngine(ctx.queryEngine)) return null
  const organizationId = typeof ctx.organizationId === 'string' && ctx.organizationId.length ? ctx.organizationId : null
  return { tenantId: ctx.tenantId, organizationId, queryEngine: ctx.queryEngine }
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1
}

async function loadLiveExtraction(
  scope: ScopedSearchContext,
  extractionId: string,
): Promise<Record<string, unknown> | null> {
  const result = await scope.queryEngine.query<Record<string, unknown>>(DOCUMENT_EXTRACTION_ENTITY_ID, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId ?? undefined,
    filters: { id: { $eq: extractionId } },
    fields: ['id', 'tenant_id', 'partition_code', 'engine_version', 'deleted_at'],
    page: { page: 1, pageSize: 1 },
  })
  const row = result.items[0]
  if (!row || readString(row, 'id', 'id') !== extractionId) return null
  if (pick(row, 'deleted_at', 'deletedAt') != null) return null
  const rowTenantId = readString(row, 'tenant_id', 'tenantId')
  if (rowTenantId !== null && rowTenantId !== scope.tenantId) return null
  return row
}

async function isPartitionIndexingSections(scope: ScopedSearchContext, partitionCode: string): Promise<boolean> {
  const result = await scope.queryEngine.query<Record<string, unknown>>(PARTITION_ENTITY_ID, {
    tenantId: scope.tenantId,
    omitAutomaticTenantOrgScope: true,
    filters: {
      code: { $eq: partitionCode },
      $or: [{ tenant_id: { $exists: false } }, { tenant_id: { $eq: scope.tenantId } }],
    },
    fields: ['id', 'code', 'tenant_id', 'index_document_sections'],
    page: { page: 1, pageSize: 2 },
  })
  return result.items.some((row) => {
    if (readString(row, 'code', 'code') !== partitionCode) return false
    const rowTenantId = readString(row, 'tenant_id', 'tenantId')
    if (rowTenantId !== null && rowTenantId !== scope.tenantId) return false
    return isTruthyFlag(pick(row, 'index_document_sections', 'indexDocumentSections'))
  })
}

async function loadAttachmentFileName(scope: ScopedSearchContext, attachmentId: string): Promise<string | null> {
  try {
    const result = await scope.queryEngine.query<Record<string, unknown>>(ATTACHMENT_ENTITY_ID, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId ?? undefined,
      filters: { id: { $eq: attachmentId } },
      fields: ['id', 'file_name'],
      page: { page: 1, pageSize: 1 },
    })
    const row = result.items[0]
    return row ? readString(row, 'file_name', 'fileName') : null
  } catch (error) {
    logger.warn('[search.attachments] Failed to load attachment for section result', {
      attachmentId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function shouldIndexDocumentSection(ctx: SearchBuildContext): Promise<boolean> {
  const scope = resolveScope(ctx)
  if (!scope) return false
  const section = readSection(ctx.record)
  if (!section.extractionId) return false
  try {
    const extraction = await loadLiveExtraction(scope, section.extractionId)
    if (!extraction) return false
    const partitionCode = readString(extraction, 'partition_code', 'partitionCode')
    if (!partitionCode) return false
    return await isPartitionIndexingSections(scope, partitionCode)
  } catch (error) {
    logger.warn('[search.attachments] Section index gate lookup failed, excluding section', {
      extractionId: section.extractionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

async function buildPresenter(section: SectionRecord, fileName: string | null): Promise<SearchResultPresenter> {
  const { translate } = await resolveTranslations()
  const citation = buildCitation({
    numberLabel: section.numberLabel,
    heading: section.heading,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  })
  return {
    title: citation || translate('attachments.search.fallback.title', 'Document section'),
    subtitle: fileName ?? undefined,
    icon: SECTION_ICON,
    badge: translate('attachments.search.badge.section', 'Section'),
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: DOCUMENT_SECTION_SEARCH_ENTITY_ID,
      enabled: true,
      priority: 5,
      strategies: ['fulltext', 'vector', 'tokens'],
      shouldIndex: shouldIndexDocumentSection,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        const scope = resolveScope(ctx)
        if (!scope) return null
        const section = readSection(ctx.record)
        if (!section.text) return null
        const headingPath = section.headingPath.join(` ${DOCUMENT_HEADING_PATH_SEPARATOR} `)
        const extraction = section.extractionId
          ? await loadLiveExtraction(scope, section.extractionId).catch(() => null)
          : null
        const fileName = section.attachmentId ? await loadAttachmentFileName(scope, section.attachmentId) : null
        return {
          text: headingPath ? [headingPath, section.text] : [section.text],
          presenter: await buildPresenter(section, fileName),
          checksumSource: {
            textSha256: section.textSha256,
            engineVersion: extraction ? readInteger(extraction, 'engine_version', 'engineVersion') : null,
            fileName,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const scope = resolveScope(ctx)
        const section = readSection(ctx.record)
        const fileName = scope && section.attachmentId ? await loadAttachmentFileName(scope, section.attachmentId) : null
        return buildPresenter(section, fileName)
      },

      resolveUrl: (): string => DOCUMENT_SECTION_SEARCH_URL,

      fieldPolicy: {
        searchable: ['number_label', 'heading', 'text'],
        excluded: [
          'tenant_id',
          'organization_id',
          'extraction_id',
          'attachment_id',
          'parent_id',
          'ordinal',
          'depth',
          'kind',
          'heading_path',
          'page_start',
          'page_end',
          'char_start',
          'char_end',
          'anchor_key',
          'text_sha256',
          'token_estimate',
          'source',
          'created_at',
        ],
      },
      aclFeatures: ['attachments.view'],
    },
  ],
}

export default searchConfig
