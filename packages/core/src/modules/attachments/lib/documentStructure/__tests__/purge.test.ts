/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentDocumentExtraction, AttachmentDocumentSection } from '../../../data/entities'
import { purgeDocumentStructure } from '../purge'

type Row = {
  id: string
  attachmentId: string
  tenantId: string | null
  organizationId: string | null
  extractionId?: string
  stats?: Record<string, unknown> | null
}

const COLUMN_TO_FIELD: Record<string, keyof Row> = {
  attachment_id: 'attachmentId',
  tenant_id: 'tenantId',
  organization_id: 'organizationId',
}

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const ORG_B = '44444444-4444-4444-8444-444444444444'
const ATTACHMENT_ID = '55555555-5555-4555-8555-555555555555'

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (row[key as keyof Row] ?? null) === (value ?? null))
}

function createEm(seed: { extractions: Row[]; sections: Row[] }) {
  const tables = new Map<unknown, Row[]>([
    [AttachmentDocumentExtraction, [...seed.extractions]],
    [AttachmentDocumentSection, [...seed.sections]],
  ])
  const deleteOrder: unknown[] = []
  const rawPredicates: string[] = []
  const selectIndexed = () => {
    const filters: Array<(pair: { section: Row; extraction: Row }) => boolean> = []
    const builder = {
      innerJoin: jest.fn(() => builder),
      select: jest.fn(() => builder),
      orderBy: jest.fn(() => builder),
      where: jest.fn((column: unknown, operator?: string, value?: unknown) => {
        if (typeof column !== 'string') {
          rawPredicates.push(JSON.stringify((column as { toOperationNode(): unknown }).toOperationNode()))
          filters.push(({ extraction }) => extraction.stats?.searchIndexed === true)
          return builder
        }
        const [alias, columnName] = column.split('.')
        const field = COLUMN_TO_FIELD[columnName]
        const expected = operator === 'is' ? null : value
        filters.push((pair) => ((pair[alias as 'section' | 'extraction'][field] ?? null) === expected))
        return builder
      }),
      execute: jest.fn(async () => {
        const extractions = tables.get(AttachmentDocumentExtraction) ?? []
        const pairs = (tables.get(AttachmentDocumentSection) ?? []).flatMap((section) => {
          const extraction = extractions.find((candidate) => candidate.id === section.extractionId)
          return extraction ? [{ section, extraction }] : []
        })
        return pairs
          .filter((pair) => filters.every((filter) => filter(pair)))
          .map((pair) => ({ id: pair.section.id }))
      }),
    }
    return builder
  }
  const getKysely = jest.fn(() => ({ selectFrom: jest.fn(() => selectIndexed()) }))
  const nativeDelete = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    deleteOrder.push(entity)
    const rows = tables.get(entity) ?? []
    const kept = rows.filter((row) => !matches(row, where))
    tables.set(entity, kept)
    return rows.length - kept.length
  })
  const em = {
    nativeDelete,
    getKysely,
    rawPredicates,
    transactional: jest.fn(async <T>(
      work: (tx: { nativeDelete: typeof nativeDelete; getKysely: typeof getKysely }) => Promise<T>,
    ) => work({ nativeDelete, getKysely })),
    find: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn(),
    rows: (entity: unknown) => tables.get(entity) ?? [],
    deleteOrder,
  }
  return em
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A, ...overrides }
}

describe('purgeDocumentStructure', () => {
  const scope = { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }

  it('deletes every extraction and section of the attachment within its scope in one transaction', async () => {
    const em = createEm({
      extractions: [row('ext-live'), row('ext-superseded'), row('ext-other-tenant', { tenantId: TENANT_B, organizationId: ORG_B })],
      sections: [row('sec-1'), row('sec-2'), row('sec-other-attachment', { attachmentId: 'other' })],
    })

    const result = await purgeDocumentStructure(em as unknown as EntityManager, scope)

    expect(result).toEqual({ extractionCount: 2, sectionCount: 2, indexedSectionIds: [] })
    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(em.nativeDelete).toHaveBeenCalledWith(AttachmentDocumentSection, {
      attachmentId: ATTACHMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })
    expect(em.deleteOrder).toEqual([AttachmentDocumentSection, AttachmentDocumentExtraction])
    expect(em.find).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
    expect(em.rows(AttachmentDocumentExtraction).map((entry) => entry.id)).toEqual(['ext-other-tenant'])
    expect(em.rows(AttachmentDocumentSection).map((entry) => entry.id)).toEqual(['sec-other-attachment'])
  })

  it('is idempotent when nothing is left to purge', async () => {
    const em = createEm({ extractions: [row('ext-live')], sections: [row('sec-1')] })

    await purgeDocumentStructure(em as unknown as EntityManager, scope)
    const second = await purgeDocumentStructure(em as unknown as EntityManager, scope)

    expect(second).toEqual({ extractionCount: 0, sectionCount: 0, indexedSectionIds: [] })
    expect(em.rows(AttachmentDocumentExtraction)).toEqual([])
  })

  it('runs on the passed entity manager so it joins the ambient transaction when flush is false', async () => {
    const em = createEm({ extractions: [row('ext-live')], sections: [row('sec-1')] })

    const result = await purgeDocumentStructure(em as unknown as EntityManager, scope, { flush: false })

    expect(result).toEqual({ extractionCount: 1, sectionCount: 1, indexedSectionIds: [] })
    expect(em.transactional).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.rows(AttachmentDocumentExtraction)).toEqual([])
    expect(em.rows(AttachmentDocumentSection)).toEqual([])
  })

  it('returns the section ids of search-indexed extractions within scope before deleting them', async () => {
    const em = createEm({
      extractions: [
        row('ext-indexed', { stats: { searchIndexed: true } }),
        row('ext-plain', { stats: { pageCount: 3 } }),
        row('ext-null-stats', { stats: null }),
        row('ext-other-tenant', { tenantId: TENANT_B, organizationId: ORG_B, stats: { searchIndexed: true } }),
      ],
      sections: [
        row('sec-indexed-1', { extractionId: 'ext-indexed' }),
        row('sec-indexed-2', { extractionId: 'ext-indexed' }),
        row('sec-plain', { extractionId: 'ext-plain' }),
        row('sec-null-stats', { extractionId: 'ext-null-stats' }),
        row('sec-other-tenant', { extractionId: 'ext-other-tenant', tenantId: TENANT_B, organizationId: ORG_B }),
      ],
    })

    const result = await purgeDocumentStructure(em as unknown as EntityManager, scope)

    expect(result.indexedSectionIds).toEqual(['sec-indexed-1', 'sec-indexed-2'])
    expect(result.sectionCount).toBe(4)
    expect(em.rawPredicates).toHaveLength(1)
    expect(em.rawPredicates[0]).toContain('searchIndexed')
    const selectOrder = em.getKysely.mock.invocationCallOrder[0]
    expect(selectOrder).toBeLessThan(em.nativeDelete.mock.invocationCallOrder[0])
    expect(em.rows(AttachmentDocumentSection).map((entry) => entry.id)).toEqual(['sec-other-tenant'])
  })

  it('selects indexed sections on the passed entity manager when flush is false', async () => {
    const em = createEm({
      extractions: [row('ext-indexed', { stats: { searchIndexed: true } })],
      sections: [row('sec-indexed', { extractionId: 'ext-indexed' })],
    })

    const result = await purgeDocumentStructure(em as unknown as EntityManager, scope, { flush: false })

    expect(result.indexedSectionIds).toEqual(['sec-indexed'])
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('rejects a half-scoped request', async () => {
    const em = createEm({ extractions: [], sections: [] })

    await expect(
      purgeDocumentStructure(em as unknown as EntityManager, { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: null }),
    ).rejects.toThrow('[internal]')
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })
})
