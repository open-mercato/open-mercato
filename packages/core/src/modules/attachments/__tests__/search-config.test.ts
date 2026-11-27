import type { QueryEngine, QueryOptions } from '@open-mercato/shared/lib/query/types'
import type { SearchBuildContext } from '@open-mercato/shared/modules/search'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string) => {
      if (key === 'attachments.search.badge.section') return 'Localized section'
      if (key === 'attachments.search.fallback.title') return 'Localized fallback'
      return fallback
    },
  })),
}))

import {
  DOCUMENT_SECTION_SEARCH_ENTITY_ID,
  DOCUMENT_SECTION_SEARCH_URL,
  searchConfig,
  shouldIndexDocumentSection,
} from '../search'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const EXTRACTION_ID = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'

type Row = Record<string, unknown>

type Fixture = {
  extraction?: Row | null
  partitions?: Row[]
  attachment?: Row | null
  failOn?: string
}

function createQueryEngine(fixture: Fixture) {
  const query = jest.fn(async (entityId: string, _options: QueryOptions) => {
    if (fixture.failOn === entityId) throw new Error('lookup failed')
    let items: Row[] = []
    if (entityId === 'attachments:attachment_document_extraction') items = fixture.extraction ? [fixture.extraction] : []
    if (entityId === 'attachments:attachment_partition') items = fixture.partitions ?? []
    if (entityId === 'attachments:attachment') items = fixture.attachment ? [fixture.attachment] : []
    return { items, total: items.length, page: 1, pageSize: 1 }
  })
  return { query, engine: { query } as unknown as QueryEngine }
}

function liveExtraction(overrides: Row = {}): Row {
  return {
    id: EXTRACTION_ID,
    tenant_id: TENANT_ID,
    partition_code: 'rulebooks',
    engine_version: 3,
    deleted_at: null,
    ...overrides,
  }
}

function partition(overrides: Row = {}): Row {
  return { id: 'partition-1', code: 'rulebooks', tenant_id: null, index_document_sections: true, ...overrides }
}

function sectionRecord(overrides: Row = {}): Row {
  return {
    id: 'section-1',
    tenant_id: TENANT_ID,
    organization_id: ORG_ID,
    extraction_id: EXTRACTION_ID,
    attachment_id: ATTACHMENT_ID,
    number_label: '§8.12',
    heading: 'Refund window',
    heading_path: ['Chapter 8', 'Refunds', 'Refund window'],
    text: 'Refunds are accepted within 30 days.',
    page_start: 14,
    page_end: 15,
    text_sha256: 'a'.repeat(16),
    anchor_key: 'b'.repeat(16),
    ...overrides,
  }
}

function buildContext(engine: QueryEngine | undefined, overrides: Partial<SearchBuildContext> = {}): SearchBuildContext {
  return {
    record: sectionRecord(),
    customFields: {},
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    queryEngine: engine,
    ...overrides,
  }
}

const sectionEntity = searchConfig.entities[0]

describe('attachments document section search config', () => {
  it('declares the section entity with the view feature and the index gate', () => {
    expect(searchConfig.entities).toHaveLength(1)
    expect(sectionEntity.entityId).toBe(DOCUMENT_SECTION_SEARCH_ENTITY_ID)
    expect(sectionEntity.aclFeatures).toEqual(['attachments.view'])
    expect(sectionEntity.strategies).toEqual(['fulltext', 'vector', 'tokens'])
    expect(sectionEntity.shouldIndex).toBe(shouldIndexDocumentSection)
  })

  describe('shouldIndex gate', () => {
    it('indexes a section of a live extraction in an opted-in global partition', async () => {
      const { engine, query } = createQueryEngine({ extraction: liveExtraction(), partitions: [partition()] })
      await expect(shouldIndexDocumentSection(buildContext(engine))).resolves.toBe(true)
      const [extractionCall, partitionCall] = query.mock.calls
      expect(extractionCall[0]).toBe('attachments:attachment_document_extraction')
      expect(extractionCall[1]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, filters: { id: { $eq: EXTRACTION_ID } } })
      expect(partitionCall[0]).toBe('attachments:attachment_partition')
      expect(partitionCall[1]).toMatchObject({
        tenantId: TENANT_ID,
        omitAutomaticTenantOrgScope: true,
        filters: {
          code: { $eq: 'rulebooks' },
          $or: [{ tenant_id: { $exists: false } }, { tenant_id: { $eq: TENANT_ID } }],
        },
      })
    })

    it('indexes a section in an opted-in same-tenant partition', async () => {
      const { engine } = createQueryEngine({
        extraction: liveExtraction(),
        partitions: [partition({ tenant_id: TENANT_ID })],
      })
      await expect(shouldIndexDocumentSection(buildContext(engine))).resolves.toBe(true)
    })

    it.each<[string, Fixture, Partial<SearchBuildContext>]>([
      ['the extraction is soft-deleted', { extraction: liveExtraction({ deleted_at: new Date().toISOString() }), partitions: [partition()] }, {}],
      ['the extraction is missing', { extraction: null, partitions: [partition()] }, {}],
      ['the extraction belongs to another tenant', { extraction: liveExtraction({ tenant_id: OTHER_TENANT_ID }), partitions: [partition()] }, {}],
      ['the partition has indexing off', { extraction: liveExtraction(), partitions: [partition({ index_document_sections: false })] }, {}],
      ['the partition is missing', { extraction: liveExtraction(), partitions: [] }, {}],
      ['the partition belongs to another tenant', { extraction: liveExtraction(), partitions: [partition({ tenant_id: OTHER_TENANT_ID })] }, {}],
      ['the record has no tenant', { extraction: liveExtraction(), partitions: [partition()] }, { tenantId: null }],
      ['the record has no extraction id', { extraction: liveExtraction(), partitions: [partition()] }, { record: sectionRecord({ extraction_id: null }) }],
      ['the extraction lookup throws', { extraction: liveExtraction(), partitions: [partition()], failOn: 'attachments:attachment_document_extraction' }, {}],
      ['the partition lookup throws', { extraction: liveExtraction(), partitions: [partition()], failOn: 'attachments:attachment_partition' }, {}],
    ])('excludes the section when %s', async (_label, fixture, overrides) => {
      const { engine } = createQueryEngine(fixture)
      await expect(shouldIndexDocumentSection(buildContext(engine, overrides))).resolves.toBe(false)
    })

    it('excludes the section when no query engine is available', async () => {
      await expect(shouldIndexDocumentSection(buildContext(undefined))).resolves.toBe(false)
    })
  })

  describe('buildSource', () => {
    it('builds the heading path and text with a citation presenter and checksum source', async () => {
      const { engine } = createQueryEngine({
        extraction: liveExtraction(),
        partitions: [partition()],
        attachment: { id: ATTACHMENT_ID, file_name: 'rulebook.pdf' },
      })
      const source = await sectionEntity.buildSource?.(buildContext(engine))
      expect(source?.text).toEqual(['Chapter 8 › Refunds › Refund window', 'Refunds are accepted within 30 days.'])
      expect(source?.presenter).toEqual({
        title: '§8.12 Refund window (pp. 14–15)',
        subtitle: 'rulebook.pdf',
        icon: 'file-text',
        badge: 'Localized section',
      })
      expect(source?.checksumSource).toEqual({ textSha256: 'a'.repeat(16), engineVersion: 3, fileName: 'rulebook.pdf' })
    })

    it('accepts a JSON-encoded heading path and camelCase records', async () => {
      const { engine } = createQueryEngine({ extraction: liveExtraction(), attachment: null })
      const source = await sectionEntity.buildSource?.(buildContext(engine, {
        record: {
          extractionId: EXTRACTION_ID,
          attachmentId: ATTACHMENT_ID,
          numberLabel: null,
          heading: null,
          headingPath: JSON.stringify(['Annex']),
          text: 'Annex body',
          pageStart: 3,
          pageEnd: 3,
          textSha256: 'c'.repeat(16),
        },
      }))
      expect(source?.text).toEqual(['Annex', 'Annex body'])
      expect(source?.presenter).toMatchObject({ title: 'p. 3', subtitle: undefined })
    })

    it('returns no source for a tenant-less record or a section without text', async () => {
      const { engine } = createQueryEngine({ extraction: liveExtraction() })
      await expect(sectionEntity.buildSource?.(buildContext(engine, { tenantId: null }))).resolves.toBeNull()
      await expect(sectionEntity.buildSource?.(buildContext(engine, { record: sectionRecord({ text: '' }) }))).resolves.toBeNull()
    })
  })

  it('formats results with the citation title and a localized fallback', async () => {
    const { engine } = createQueryEngine({ attachment: { id: ATTACHMENT_ID, file_name: 'rulebook.pdf' } })
    await expect(sectionEntity.formatResult?.(buildContext(engine))).resolves.toEqual({
      title: '§8.12 Refund window (pp. 14–15)',
      subtitle: 'rulebook.pdf',
      icon: 'file-text',
      badge: 'Localized section',
    })
    const fallback = await sectionEntity.formatResult?.(buildContext(engine, {
      record: sectionRecord({ number_label: null, heading: null, page_start: null, page_end: null }),
    }))
    expect(fallback?.title).toBe('Localized fallback')
  })

  it('resolves results to the attachments library page', async () => {
    await expect(Promise.resolve(sectionEntity.resolveUrl?.(buildContext(undefined)))).resolves.toBe(DOCUMENT_SECTION_SEARCH_URL)
    expect(DOCUMENT_SECTION_SEARCH_URL).toBe('/backend/storage/attachments')
  })

  it('limits searchable fields to structural text and excludes everything else', () => {
    const policy = sectionEntity.fieldPolicy
    expect(policy?.searchable).toEqual(['number_label', 'heading', 'text'])
    expect(policy?.hashOnly).toBeUndefined()
    for (const field of ['tenant_id', 'organization_id', 'extraction_id', 'attachment_id', 'heading_path', 'anchor_key', 'text_sha256', 'char_start', 'char_end']) {
      expect(policy?.excluded).toContain(field)
    }
    for (const field of policy?.searchable ?? []) {
      expect(policy?.excluded).not.toContain(field)
    }
  })
})
