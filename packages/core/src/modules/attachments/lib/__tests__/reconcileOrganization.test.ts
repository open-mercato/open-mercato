/** @jest-environment node */

jest.mock('@open-mercato/core/modules/attachments/data/entities', () => ({
  Attachment: class Attachment {},
}))

import { reconcileAttachmentOrganizations } from '../reconcileOrganization'

type ScanRow = {
  id: string
  entity_id: string | null
  record_id: string | null
  organization_id: string | null
}

function buildEm(scanRows: ScanRow[]) {
  const references: Array<{ id: string; organizationId: string | null }> = []
  const flushed: Array<{ id: string; organizationId: string | null }> = []
  const em = {
    getConnection: () => ({
      execute: jest.fn(async () => scanRows),
    }),
    getReference: (_entity: unknown, id: string) => {
      const ref = { id, organizationId: null as string | null }
      references.push(ref)
      return ref
    },
    flush: jest.fn(async () => {
      for (const ref of references) flushed.push({ id: ref.id, organizationId: ref.organizationId })
    }),
    transactional: jest.fn(async (callback: () => Promise<unknown>) => callback()),
  }
  return { em, flushed }
}

function buildQueryEngine(parentOrgByEntity: Record<string, Record<string, string | null>>) {
  return {
    query: jest.fn(async (entityId: string, opts: any) => {
      const table = parentOrgByEntity[entityId]
      if (!table) throw new Error(`unregistered entity: ${entityId}`)
      const filter = opts?.filters?.id ?? {}
      const ids: string[] = filter.$in ?? (filter.$eq ? [filter.$eq] : [])
      const items = ids
        .filter((id) => id in table)
        .map((id) => ({ id, organization_id: table[id] }))
      return { items }
    }),
  }
}

describe('reconcileAttachmentOrganizations', () => {
  it('moves a misfiled attachment to its parent record organization (#3765)', async () => {
    const { em, flushed } = buildEm([
      { id: 'att-1', entity_id: 'catalog:product_variant', record_id: 'var-1', organization_id: 'home-org' },
    ])
    const queryEngine = buildQueryEngine({
      'catalog:product_variant': { 'var-1': 'selected-org' },
    })

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.updated).toBe(1)
    expect(flushed).toEqual([{ id: 'att-1', organizationId: 'selected-org' }])
    expect(queryEngine.query).toHaveBeenCalledWith(
      'catalog:product_variant',
      expect.objectContaining({ tenantId: 't1', withDeleted: true }),
    )
  })

  it('leaves an already-correctly-filed attachment untouched (idempotent)', async () => {
    const { em, flushed } = buildEm([
      { id: 'att-1', entity_id: 'catalog:product', record_id: 'p-1', organization_id: 'org-a' },
    ])
    const queryEngine = buildQueryEngine({ 'catalog:product': { 'p-1': 'org-a' } })

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.updated).toBe(0)
    expect(report.unresolved).toBe(0)
    expect(flushed).toEqual([])
  })

  it('skips library attachments as a virtual entity, not as unresolved', async () => {
    const { em, flushed } = buildEm([
      { id: 'lib-1', entity_id: 'attachments:library', record_id: 'lib-record', organization_id: 'org-a' },
    ])
    const queryEngine = buildQueryEngine({})

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.skippedVirtual).toBe(1)
    expect(report.unresolved).toBe(0)
    expect(report.updated).toBe(0)
    expect(queryEngine.query).not.toHaveBeenCalled()
    expect(flushed).toEqual([])
  })

  it('counts rows as unresolved when the parent entity cannot be queried', async () => {
    const { em, flushed } = buildEm([
      { id: 'att-1', entity_id: 'unknown:thing', record_id: 'x-1', organization_id: 'home-org' },
    ])
    const queryEngine = buildQueryEngine({})

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.unresolved).toBe(1)
    expect(report.updated).toBe(0)
    expect(flushed).toEqual([])
  })

  it('counts a row as unresolved when the parent record has no organization', async () => {
    const { em, flushed } = buildEm([
      { id: 'att-1', entity_id: 'catalog:product', record_id: 'p-missing', organization_id: 'home-org' },
    ])
    const queryEngine = buildQueryEngine({ 'catalog:product': { 'p-missing': null } })

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.unresolved).toBe(1)
    expect(report.updated).toBe(0)
    expect(flushed).toEqual([])
  })

  it('still heals other groups when one entity group is unregistrable (#4145)', async () => {
    const { em, flushed } = buildEm([
      { id: 'att-bogus', entity_id: 'some:bogus_entity', record_id: 'x-1', organization_id: 'home-org' },
      { id: 'att-good', entity_id: 'catalog:product', record_id: 'p-1', organization_id: 'home-org' },
    ])
    const queryEngine = buildQueryEngine({ 'catalog:product': { 'p-1': 'selected-org' } })

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.unresolved).toBe(1)
    expect(report.updated).toBe(1)
    expect(report.byEntity['some:bogus_entity']).toEqual({ scanned: 1, updated: 0, unresolved: 1 })
    expect(flushed).toEqual([{ id: 'att-good', organizationId: 'selected-org' }])
  })

  it('scopes every parent-resolution query to a nested transaction savepoint (#4145)', async () => {
    const { em } = buildEm([
      { id: 'att-1', entity_id: 'catalog:product', record_id: 'p-1', organization_id: 'org-a' },
    ])
    const queryEngine = buildQueryEngine({ 'catalog:product': { 'p-1': 'org-a' } })

    await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(em.transactional).toHaveBeenCalledTimes(1)
    expect(queryEngine.query).toHaveBeenCalledTimes(1)
  })

  it('reconciles a mixed batch and reports per-entity stats', async () => {
    const { em, flushed } = buildEm([
      { id: 'a1', entity_id: 'catalog:product', record_id: 'p1', organization_id: 'wrong' },
      { id: 'a2', entity_id: 'catalog:product', record_id: 'p2', organization_id: 'right' },
      { id: 'a3', entity_id: 'attachments:library', record_id: 'lib', organization_id: 'any' },
    ])
    const queryEngine = buildQueryEngine({
      'catalog:product': { p1: 'right', p2: 'right' },
    })

    const report = await reconcileAttachmentOrganizations({
      em: em as any,
      queryEngine: queryEngine as any,
      tenantId: 't1',
    })

    expect(report.scanned).toBe(3)
    expect(report.updated).toBe(1)
    expect(report.skippedVirtual).toBe(1)
    expect(report.byEntity['catalog:product']).toEqual({ scanned: 2, updated: 1, unresolved: 0 })
    expect(flushed).toEqual([{ id: 'a1', organizationId: 'right' }])
  })
})
