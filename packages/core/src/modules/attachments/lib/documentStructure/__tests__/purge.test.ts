/** @jest-environment node */

import type { EntityManager } from '@mikro-orm/postgresql'
import { AttachmentDocumentExtraction, AttachmentDocumentSection } from '../../../data/entities'
import { purgeDocumentStructure } from '../purge'

type Row = { id: string; attachmentId: string; tenantId: string | null; organizationId: string | null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(
    async (em: { __find: (entity: unknown, where: Record<string, unknown>) => Row[] }, entity: unknown, where: Record<string, unknown>) =>
      em.__find(entity, where),
  ),
}))

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
  const pendingRemovals: Row[] = []
  const em = {
    __find: (entity: unknown, where: Record<string, unknown>) =>
      (tables.get(entity) ?? []).filter((row) => matches(row, where)),
    remove: jest.fn((row: Row) => {
      pendingRemovals.push(row)
      return em
    }),
    flush: jest.fn(async () => {
      for (const [entity, rows] of tables) {
        tables.set(entity, rows.filter((row) => !pendingRemovals.includes(row)))
      }
      pendingRemovals.length = 0
    }),
    rows: (entity: unknown) => tables.get(entity) ?? [],
  }
  return em
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A, ...overrides }
}

describe('purgeDocumentStructure', () => {
  const scope = { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: ORG_A }

  it('removes every extraction and section of the attachment within its scope', async () => {
    const em = createEm({
      extractions: [row('ext-live'), row('ext-superseded'), row('ext-other-tenant', { tenantId: TENANT_B, organizationId: ORG_B })],
      sections: [row('sec-1'), row('sec-2'), row('sec-other-attachment', { attachmentId: 'other' })],
    })

    const result = await purgeDocumentStructure(em as unknown as EntityManager, scope)

    expect(result).toEqual({ extractionCount: 2, sectionCount: 2 })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.rows(AttachmentDocumentExtraction).map((entry) => entry.id)).toEqual(['ext-other-tenant'])
    expect(em.rows(AttachmentDocumentSection).map((entry) => entry.id)).toEqual(['sec-other-attachment'])
  })

  it('is idempotent when nothing is left to purge', async () => {
    const em = createEm({ extractions: [row('ext-live')], sections: [row('sec-1')] })

    await purgeDocumentStructure(em as unknown as EntityManager, scope)
    const second = await purgeDocumentStructure(em as unknown as EntityManager, scope)

    expect(second).toEqual({ extractionCount: 0, sectionCount: 0 })
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.rows(AttachmentDocumentExtraction)).toEqual([])
  })

  it('leaves the removal to the caller unit of work when flush is false', async () => {
    const em = createEm({ extractions: [row('ext-live')], sections: [row('sec-1')] })

    await purgeDocumentStructure(em as unknown as EntityManager, scope, { flush: false })

    expect(em.remove).toHaveBeenCalledTimes(2)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.rows(AttachmentDocumentExtraction)).toHaveLength(1)
    await em.flush()
    expect(em.rows(AttachmentDocumentExtraction)).toEqual([])
    expect(em.rows(AttachmentDocumentSection)).toEqual([])
  })

  it('rejects a half-scoped request', async () => {
    const em = createEm({ extractions: [], sections: [] })

    await expect(
      purgeDocumentStructure(em as unknown as EntityManager, { attachmentId: ATTACHMENT_ID, tenantId: TENANT_A, organizationId: null }),
    ).rejects.toThrow('[internal]')
    expect(em.remove).not.toHaveBeenCalled()
  })
})
