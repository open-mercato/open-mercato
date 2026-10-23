/** @jest-environment node */

import { asValue, createContainer, InjectionMode } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  Attachment,
  AttachmentDocumentExtraction,
  AttachmentDocumentSection,
  AttachmentPartition,
} from '../../../data/entities'
import { register } from '../../../di'
import { resolveDocumentStructureWorkerDeps } from '../../../workers/document-structure'
import {
  createDocumentStructureEngineRegistry,
  DOCUMENT_STRUCTURE_ENGINES_DI_KEY,
  type DocumentStructureEngineRegistry,
} from '../engines/registry'
import { buildAnchorKey, buildCitationRef } from '../locator'
import {
  ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY,
  createAttachmentDocumentStructureService,
  DOCUMENT_SECTIONS_MAX_PAGE_SIZE,
  type AttachmentDocumentStructureService,
  type DocumentStructureAccessScope,
  type DocumentStructureEnqueue,
} from '../service'

type Row = Record<string, unknown>
type Operators = { $gt?: number; $gte?: number; $lt?: number; $lte?: number; $in?: unknown[] }
type FindOptions = { fields?: string[]; orderBy?: Record<string, 'asc' | 'desc'>; limit?: number }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(
    async (em: { __find: (entity: unknown, where: Row, options?: FindOptions) => Row[] }, entity: unknown, where: Row) =>
      em.__find(entity, where)[0] ?? null,
  ),
  findWithDecryption: jest.fn(
    async (
      em: { __find: (entity: unknown, where: Row, options?: FindOptions) => Row[] },
      entity: unknown,
      where: Row,
      options?: FindOptions,
    ) => em.__find(entity, where, options),
  ),
}))

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'
const PUBLIC_ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'
const EXTRACTION_ID = '77777777-7777-4777-8777-777777777777'
const STALE_EXTRACTION_ID = '88888888-8888-4888-8888-888888888888'
const SECTION_COUNT = 150

function isOperators(value: unknown): value is Operators {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (!isOperators(expected)) return (actual ?? null) === (expected ?? null)
  if (expected.$in !== undefined && !expected.$in.includes(actual)) return false
  const numeric = typeof actual === 'number' ? actual : null
  if (expected.$gt !== undefined && (numeric === null || numeric <= expected.$gt)) return false
  if (expected.$gte !== undefined && (numeric === null || numeric < expected.$gte)) return false
  if (expected.$lt !== undefined && (numeric === null || numeric >= expected.$lt)) return false
  if (expected.$lte !== undefined && (numeric === null || numeric > expected.$lte)) return false
  return true
}

function createFakeEm() {
  const tables = new Map<unknown, Row[]>([
    [Attachment, []],
    [AttachmentPartition, []],
    [AttachmentDocumentExtraction, []],
    [AttachmentDocumentSection, []],
  ])
  const table = (entity: unknown): Row[] => {
    const rows = tables.get(entity)
    if (!rows) throw new Error('unknown entity')
    return rows
  }
  const queries: Array<{ entity: unknown; where: Row; options?: FindOptions }> = []
  const em = {
    __find: (entity: unknown, where: Row, options?: FindOptions) => {
      queries.push({ entity, where, options })
      let rows = table(entity).filter((row) =>
        Object.entries(where).every(([key, value]) => matchesValue(row[key], value)),
      )
      const orderBy = options?.orderBy
      if (orderBy) {
        const [[key, direction]] = Object.entries(orderBy)
        rows = [...rows].sort((left, right) => {
          const leftValue = left[key] instanceof Date ? (left[key] as Date).getTime() : Number(left[key])
          const rightValue = right[key] instanceof Date ? (right[key] as Date).getTime() : Number(right[key])
          return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue
        })
      }
      if (options?.limit !== undefined) rows = rows.slice(0, options.limit)
      if (options?.fields) {
        const fields = options.fields
        rows = rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])))
      }
      return rows
    },
  }
  return { em: em as unknown as EntityManager, table, queries }
}

type FakeEm = ReturnType<typeof createFakeEm>

function sectionRow(ordinal: number, overrides: Row = {}): Row {
  const numberLabel = ordinal === 0 ? null : `${ordinal}`
  const headingPath = ordinal === 0 ? [] : [`${ordinal} Heading`]
  return {
    id: `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`,
    tenantId: TENANT_A,
    organizationId: ORG_A,
    extractionId: EXTRACTION_ID,
    attachmentId: ATTACHMENT_ID,
    parentId: ordinal === 0 ? null : '00000000-0000-4000-8000-000000000000',
    ordinal,
    depth: ordinal === 0 ? 0 : 1,
    kind: ordinal === 0 ? 'document' : 'section',
    numberLabel,
    heading: ordinal === 0 ? 'Policy' : `Heading ${ordinal}`,
    headingPath,
    text: `Section ${ordinal} body text`,
    pageStart: Math.max(1, Math.ceil(ordinal / 10)),
    pageEnd: Math.max(1, Math.ceil(ordinal / 10)),
    charStart: ordinal * 100,
    charEnd: ordinal * 100 + 20,
    anchorKey: buildAnchorKey({ numberLabel, headingPath }),
    textSha256: 'f'.repeat(64),
    tokenEstimate: 5,
    source: 'text_layer',
    ...overrides,
  }
}

function seed(fake: FakeEm) {
  fake.table(AttachmentPartition).push(
    { code: 'privateAttachments', isPublic: false, tenantId: null, organizationId: null },
    { code: 'publicAttachments', isPublic: true, tenantId: null, organizationId: null },
  )
  fake.table(Attachment).push(
    {
      id: ATTACHMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      partitionCode: 'privateAttachments',
      fileName: 'policy.pdf',
      mimeType: 'application/pdf',
    },
    {
      id: PUBLIC_ATTACHMENT_ID,
      tenantId: TENANT_B,
      organizationId: ORG_B,
      partitionCode: 'publicAttachments',
      fileName: 'other.pdf',
      mimeType: 'application/pdf',
    },
  )
  fake.table(AttachmentDocumentExtraction).push(
    {
      id: STALE_EXTRACTION_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      attachmentId: ATTACHMENT_ID,
      status: 'completed',
      engine: 'pdf_layout',
      engineVersion: 1,
      contentSha256: 'a'.repeat(64),
      normalizedText: 'stale',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      deletedAt: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: EXTRACTION_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      attachmentId: ATTACHMENT_ID,
      status: 'completed',
      engine: 'pdf_layout',
      engineVersion: 1,
      contentSha256: 'b'.repeat(64),
      skipReason: null,
      pageCount: 15,
      sectionCount: SECTION_COUNT,
      charCount: 20000,
      ocrPageCount: 0,
      normalizedText: 'SECRET-NORMALIZED-TEXT '.repeat(10),
      failureReason: null,
      stats: { durationMs: 12, blockCount: 151 },
      createdAt: new Date('2026-01-03T00:00:00Z'),
      completedAt: new Date('2026-01-03T00:00:01Z'),
      deletedAt: null,
    },
  )
  for (let ordinal = 0; ordinal < SECTION_COUNT; ordinal += 1) {
    fake.table(AttachmentDocumentSection).push(sectionRow(ordinal))
  }
}

const scopeA: DocumentStructureAccessScope = {
  tenantId: TENANT_A,
  organizationId: ORG_A,
  auth: { sub: 'user-a', tenantId: TENANT_A, orgId: ORG_A },
}
const scopeB: DocumentStructureAccessScope = {
  tenantId: TENANT_B,
  organizationId: ORG_B,
  auth: { sub: 'user-b', tenantId: TENANT_B, orgId: ORG_B },
}

function setup() {
  const fake = createFakeEm()
  seed(fake)
  const enqueue = jest.fn<ReturnType<DocumentStructureEnqueue>, Parameters<DocumentStructureEnqueue>>(
    async () => 'job-1',
  )
  const service: AttachmentDocumentStructureService = createAttachmentDocumentStructureService({
    em: fake.em,
    enqueue,
  })
  return { fake, service, enqueue }
}

describe('attachmentDocumentStructureService access', () => {
  it('denies every method for a cross-tenant scope', async () => {
    const { service, enqueue } = setup()
    const ref = buildCitationRef({ attachmentId: ATTACHMENT_ID, anchorKey: sectionRow(5).anchorKey as string })
    expect(await service.getStructure({ attachmentId: ATTACHMENT_ID, scope: scopeB })).toBeNull()
    expect(await service.listSections({ attachmentId: ATTACHMENT_ID, scope: scopeB })).toBeNull()
    expect(await service.getSection({ attachmentId: ATTACHMENT_ID, scope: scopeB, numberLabel: '5' })).toBeNull()
    expect(await service.resolveCitation({ ref, scope: scopeB })).toBeNull()
    expect(await service.getStats({ attachmentId: ATTACHMENT_ID, scope: scopeB })).toBeNull()
    expect(
      await service.getNormalizedText({ attachmentId: ATTACHMENT_ID, scope: scopeB, charStart: 0, charEnd: 5 }),
    ).toBeNull()
    expect(await service.requestExtraction({ attachmentId: ATTACHMENT_ID, scope: scopeB, force: true })).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('denies a cross-organization scope inside the same tenant', async () => {
    const { service } = setup()
    const scope: DocumentStructureAccessScope = {
      tenantId: TENANT_A,
      organizationId: ORG_B,
      auth: { sub: 'user-a2', tenantId: TENANT_A, orgId: ORG_B },
    }
    expect(await service.getStructure({ attachmentId: ATTACHMENT_ID, scope })).toBeNull()
  })

  it('denies a principal whose auth does not match the requested scope', async () => {
    const { service } = setup()
    const scope: DocumentStructureAccessScope = { tenantId: TENANT_A, organizationId: ORG_A, auth: scopeB.auth }
    expect(await service.listSections({ attachmentId: ATTACHMENT_ID, scope })).toBeNull()
  })

  it('denies an unauthenticated principal even on a public partition', async () => {
    const { service } = setup()
    const scope: DocumentStructureAccessScope = { tenantId: TENANT_B, organizationId: ORG_B, auth: null }
    expect(await service.getStructure({ attachmentId: PUBLIC_ATTACHMENT_ID, scope })).toBeNull()
  })

  it('rejects a partial-null scope', async () => {
    const { service } = setup()
    await expect(
      service.getStructure({ attachmentId: ATTACHMENT_ID, scope: { tenantId: TENANT_A, organizationId: null } }),
    ).rejects.toThrow('scope invariant')
  })

  it('always scopes database lookups by tenant and organization', async () => {
    const { service, fake } = setup()
    await service.listSections({ attachmentId: ATTACHMENT_ID, scope: scopeA })
    const scopedQueries = fake.queries.filter((query) => query.entity !== AttachmentPartition)
    expect(scopedQueries.length).toBeGreaterThan(0)
    for (const query of scopedQueries) {
      expect(query.where.tenantId).toBe(TENANT_A)
      expect(query.where.organizationId).toBe(ORG_A)
    }
  })

  it('allows a same-scope service principal without auth', async () => {
    const { service } = setup()
    const structure = await service.getStructure({
      attachmentId: ATTACHMENT_ID,
      scope: { tenantId: TENANT_A, organizationId: ORG_A },
    })
    expect(structure?.extraction?.id).toBe(EXTRACTION_ID)
  })
})

describe('attachmentDocumentStructureService reads', () => {
  it('returns the live extraction and an outline with child counts', async () => {
    const { service } = setup()
    const structure = await service.getStructure({ attachmentId: ATTACHMENT_ID, scope: scopeA })
    expect(structure?.extraction).toMatchObject({ id: EXTRACTION_ID, status: 'completed', sectionCount: SECTION_COUNT })
    expect(structure?.outline).toHaveLength(SECTION_COUNT - 1)
    expect(structure?.outline[0]).toMatchObject({ kind: 'section', numberLabel: '1', childCount: 0 })
  })

  it('caps the page size at 100 and pages with a keyset cursor', async () => {
    const { service } = setup()
    const first = await service.listSections({ attachmentId: ATTACHMENT_ID, scope: scopeA, limit: 500 })
    expect(first?.items).toHaveLength(DOCUMENT_SECTIONS_MAX_PAGE_SIZE)
    expect(first?.nextCursor).toBe(DOCUMENT_SECTIONS_MAX_PAGE_SIZE - 1)
    const second = await service.listSections({
      attachmentId: ATTACHMENT_ID,
      scope: scopeA,
      limit: 500,
      afterOrdinal: first?.nextCursor ?? null,
    })
    expect(second?.items).toHaveLength(SECTION_COUNT - DOCUMENT_SECTIONS_MAX_PAGE_SIZE)
    expect(second?.items[0].ordinal).toBe(DOCUMENT_SECTIONS_MAX_PAGE_SIZE)
    expect(second?.nextCursor).toBeNull()
  })

  it('filters by number label and returns locator, citation and citation ref', async () => {
    const { service } = setup()
    const result = await service.listSections({ attachmentId: ATTACHMENT_ID, scope: scopeA, numberLabel: '§12' })
    expect(result?.items).toHaveLength(1)
    const [section] = result?.items ?? []
    expect(section).toMatchObject({
      numberLabel: '12',
      locator: 'page:2;sec=12;chars=1200-1220',
      citation: '12 Heading 12 (p. 2)',
      citationRef: `${ATTACHMENT_ID}#${section.anchorKey}`,
      text: 'Section 12 body text',
    })
  })

  it('omits text when includeText is false', async () => {
    const { service } = setup()
    const result = await service.listSections({ attachmentId: ATTACHMENT_ID, scope: scopeA, includeText: false, limit: 3 })
    for (const item of result?.items ?? []) expect(item.text).toBeUndefined()
  })

  it('gets a section by id, anchor key and number label', async () => {
    const { service } = setup()
    const target = sectionRow(7)
    const byId = await service.getSection({ attachmentId: ATTACHMENT_ID, scope: scopeA, sectionId: target.id as string })
    const byAnchor = await service.getSection({
      attachmentId: ATTACHMENT_ID,
      scope: scopeA,
      anchorKey: target.anchorKey as string,
    })
    const byNumber = await service.getSection({ attachmentId: ATTACHMENT_ID, scope: scopeA, numberLabel: '7' })
    expect(byId?.id).toBe(target.id)
    expect(byAnchor?.id).toBe(target.id)
    expect(byNumber?.id).toBe(target.id)
  })

  it('resolves a citation ref to its section', async () => {
    const { service } = setup()
    const target = sectionRow(42)
    const ref = buildCitationRef({ attachmentId: ATTACHMENT_ID, anchorKey: target.anchorKey as string })
    const resolved = await service.resolveCitation({ ref, scope: scopeA })
    expect(resolved).toMatchObject({ attachmentId: ATTACHMENT_ID, extractionId: EXTRACTION_ID })
    expect(resolved?.section.id).toBe(target.id)
    expect(resolved?.section.citationRef).toBe(ref)
    expect(await service.resolveCitation({ ref: 'not-a-ref', scope: scopeA })).toBeNull()
    expect(await service.resolveCitation({ ref: `${ATTACHMENT_ID}#${'0'.repeat(32)}`, scope: scopeA })).toBeNull()
  })

  it('returns stats without any document content', async () => {
    const { service } = setup()
    const stats = await service.getStats({ attachmentId: ATTACHMENT_ID, scope: scopeA })
    expect(stats).toMatchObject({ id: EXTRACTION_ID, attachmentId: ATTACHMENT_ID, stats: { durationMs: 12 } })
    const serialized = JSON.stringify(stats)
    expect(serialized).not.toContain('SECRET-NORMALIZED-TEXT')
    expect(serialized).not.toContain('body text')
    expect(stats).not.toHaveProperty('normalizedText')
  })

  it('returns a bounded normalized text range', async () => {
    const { service } = setup()
    expect(
      await service.getNormalizedText({ attachmentId: ATTACHMENT_ID, scope: scopeA, charStart: 0, charEnd: 6 }),
    ).toBe('SECRET')
    expect(
      await service.getNormalizedText({ attachmentId: ATTACHMENT_ID, scope: scopeA, charStart: 5, charEnd: 1 }),
    ).toBeNull()
  })
})

describe('attachmentDocumentStructureService.requestExtraction', () => {
  it('enqueues a forced re-extraction in the attachment scope', async () => {
    const { service, enqueue } = setup()
    const result = await service.requestExtraction({
      attachmentId: ATTACHMENT_ID,
      scope: scopeA,
      force: true,
      ocr: 'never',
      requestedByUserId: '99999999-9999-4999-8999-999999999999',
    })
    expect(result).toEqual({ extractionId: null, status: 'pending', enqueued: true, jobId: 'job-1' })
    expect(enqueue).toHaveBeenCalledWith({
      attachmentId: ATTACHMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      force: true,
      ocr: 'never',
      requestedByUserId: '99999999-9999-4999-8999-999999999999',
    })
  })

  it('returns the current extraction without enqueueing when not forced', async () => {
    const { service, enqueue } = setup()
    const result = await service.requestExtraction({ attachmentId: ATTACHMENT_ID, scope: scopeA })
    expect(result).toEqual({ extractionId: EXTRACTION_ID, status: 'completed', enqueued: false, jobId: null })
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('document structure DI registrations', () => {
  function buildContainer(): AppContainer {
    const container = createContainer({ injectionMode: InjectionMode.PROXY }) as AppContainer
    container.register({ em: asValue(createFakeEm().em) })
    register(container)
    return container
  }

  it('registers the service and the engine registry', () => {
    const container = buildContainer()
    const scoped = container.createScope()
    const service = scoped.resolve<AttachmentDocumentStructureService>(ATTACHMENT_DOCUMENT_STRUCTURE_SERVICE_DI_KEY)
    expect(typeof service.listSections).toBe('function')
    const registry = container.resolve<DocumentStructureEngineRegistry>(DOCUMENT_STRUCTURE_ENGINES_DI_KEY)
    expect(registry.list().map((engine) => engine.id)).toEqual(['pdf_layout', 'docx', 'text', 'ocr'])
  })

  it('lets the worker pick up an overridden engine registry', () => {
    const container = buildContainer()
    const override = createDocumentStructureEngineRegistry([])
    container.register({
      [DOCUMENT_STRUCTURE_ENGINES_DI_KEY]: asValue(override),
      storageDriverFactory: asValue({ resolveForPartition: jest.fn() }),
    })
    const deps = resolveDocumentStructureWorkerDeps({
      resolve: <T = unknown>(name: string) => container.resolve<T>(name),
    } as Parameters<typeof resolveDocumentStructureWorkerDeps>[0])
    expect(deps.registry).toBe(override)
  })
})
