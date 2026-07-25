/** @jest-environment node */
jest.mock('#generated/entities.ids.generated', () => ({
  E: { catalog: { catalog_product: 'catalog:catalog_product' } },
}), { virtual: true })

import { DEFAULT_ATTACHMENT_PARTITIONS, ensureDefaultPartitions } from '@open-mercato/core/modules/attachments/lib/partitions'

// Fresh-install / demo-mode invariant locked in for PR #2635 review:
// `ensureDefaultPartitions` MUST create the platform default partitions with
// `tenantId === null` and `organizationId === null`. The tenant-scoping fix
// (#2) treats null-tenant rows as platform defaults — visible to every
// authenticated tenant user, mutable only by superadmin. If this ever changes,
// every fresh install would silently shift the defaults under a single tenant
// or platform-scope and lose cross-tenant visibility.

type SeededRow = {
  code: string
  title: string
  description: string | null
  storageDriver: string
  isPublic: boolean
  requiresOcr: boolean
  tenantId: string | null | undefined
  organizationId: string | null | undefined
}

function makeMockEm(initialRows: { code: string }[] = []) {
  const rows: SeededRow[] = []
  const repo = {
    findAll: jest.fn(async (_options?: unknown) => initialRows),
    create: jest.fn((data: Partial<SeededRow>) => {
      const row: SeededRow = {
        code: data.code ?? '',
        title: data.title ?? '',
        description: data.description ?? null,
        storageDriver: data.storageDriver ?? 'local',
        isPublic: data.isPublic ?? false,
        requiresOcr: data.requiresOcr ?? false,
        tenantId: data.tenantId,
        organizationId: data.organizationId,
      }
      return row
    }),
  }
  const persist = jest.fn((entity: SeededRow) => {
    rows.push(entity)
  })
  const flush = jest.fn(async () => {})
  const em = {
    getRepository: () => repo,
    persist,
    flush,
  }
  return { em: em as any, repo, persist, flush, rows }
}

describe('ensureDefaultPartitions — fresh-install invariant', () => {
  it('creates every default with tenantId === null and organizationId === null', async () => {
    const { em, rows, flush, persist } = makeMockEm()
    await ensureDefaultPartitions(em)
    expect(persist).toHaveBeenCalledTimes(DEFAULT_ATTACHMENT_PARTITIONS.length)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(rows.length).toBe(DEFAULT_ATTACHMENT_PARTITIONS.length)
    for (const row of rows) {
      // `undefined` (decoder never set the field) is equivalent to NULL in
      // the column; the only forbidden state is a concrete tenant uuid.
      expect(row.tenantId == null).toBe(true)
      expect(row.organizationId == null).toBe(true)
    }
  })

  it('is idempotent when the platform defaults already exist', async () => {
    const existing = DEFAULT_ATTACHMENT_PARTITIONS.map((seed) => ({ code: seed.code }))
    const { em, persist, flush } = makeMockEm(existing)
    await ensureDefaultPartitions(em)
    expect(persist).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
  })

  it('seeds only the missing default codes when the table is partially populated', async () => {
    const [first] = DEFAULT_ATTACHMENT_PARTITIONS
    const { em, rows, persist, flush } = makeMockEm([{ code: first.code }])
    await ensureDefaultPartitions(em)
    const expected = DEFAULT_ATTACHMENT_PARTITIONS.length - 1
    expect(persist).toHaveBeenCalledTimes(expected)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(rows.map((r) => r.code)).not.toContain(first.code)
    for (const row of rows) {
      expect(row.tenantId == null).toBe(true)
      expect(row.organizationId == null).toBe(true)
    }
  })
})
