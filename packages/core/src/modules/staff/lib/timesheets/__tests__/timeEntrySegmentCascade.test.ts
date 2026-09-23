/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

import { restoreSegmentsForEntry, softDeleteSegmentsForEntry } from '../timeEntrySegmentCascade'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_ENTRY_ID = '66666666-6666-4666-8666-666666666666'

const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

type SegmentRow = {
  id: string
  tenantId: string
  organizationId: string
  timeEntryId: string
  startedAt: Date
  endedAt: Date | null
  deletedAt: Date | null
}

function makeSegment(overrides: Partial<SegmentRow> & { id: string }): SegmentRow {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    timeEntryId: ENTRY_ID,
    startedAt: new Date('2026-08-26T10:00:00.000Z'),
    endedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

/**
 * The mock filters the in-memory rows by the where clause the helper actually
 * passes, rather than returning a canned list. Without that, a helper that
 * dropped its `tenantId`/`organizationId` predicate would still pass the
 * scope-isolation test — the assertion has to be able to fail.
 */
function installTable(rows: SegmentRow[]): void {
  mockFindWithDecryption.mockImplementation(async (_em, _entity, where: Record<string, unknown>) =>
    rows.filter((row) =>
      Object.entries(where).every(([field, expected]) => {
        const actual = (row as unknown as Record<string, unknown>)[field]
        if (expected === null) return actual === null
        if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
        return actual === expected
      }),
    ),
  )
}

const em = {} as EntityManager

beforeEach(() => {
  mockFindWithDecryption.mockReset()
})

describe('softDeleteSegmentsForEntry', () => {
  it('returns zero and touches nothing for an entry with no segments', async () => {
    installTable([])
    await expect(softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, new Date())).resolves.toBe(0)
  })

  it('stamps every live segment with the caller-supplied instant', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const closed = makeSegment({ id: 'a', endedAt: new Date('2026-08-26T11:00:00.000Z') })
    const open = makeSegment({ id: 'b' })
    installTable([closed, open])

    await expect(softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(2)

    expect(closed.deletedAt).toBe(deletedAt)
    expect(open.deletedAt).toBe(deletedAt)
  })

  it('closes an open segment at the delete instant and leaves an already-closed one alone', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const alreadyEndedAt = new Date('2026-08-26T11:00:00.000Z')
    const closed = makeSegment({ id: 'a', endedAt: alreadyEndedAt })
    const open = makeSegment({ id: 'b' })
    installTable([closed, open])

    await softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)

    expect(open.endedAt).toBe(deletedAt)
    expect(closed.endedAt).toBe(alreadyEndedAt)
  })

  it('skips segments that were already soft-deleted, preserving their own timestamp', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const previouslyDeletedAt = new Date('2026-08-26T12:00:00.000Z')
    const live = makeSegment({ id: 'a' })
    const preDeleted = makeSegment({ id: 'b', deletedAt: previouslyDeletedAt })
    installTable([live, preDeleted])

    await expect(softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(1)

    expect(live.deletedAt).toBe(deletedAt)
    expect(preDeleted.deletedAt).toBe(previouslyDeletedAt)
  })

  it('never touches a segment belonging to another organization or tenant', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const inScope = makeSegment({ id: 'a' })
    const otherOrg = makeSegment({ id: 'b', organizationId: OTHER_ORG_ID })
    const otherTenant = makeSegment({ id: 'c', tenantId: OTHER_TENANT_ID })
    const otherEntry = makeSegment({ id: 'd', timeEntryId: OTHER_ENTRY_ID })
    installTable([inScope, otherOrg, otherTenant, otherEntry])

    await expect(softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(1)

    expect(inScope.deletedAt).toBe(deletedAt)
    expect(otherOrg.deletedAt).toBeNull()
    expect(otherTenant.deletedAt).toBeNull()
    expect(otherEntry.deletedAt).toBeNull()
  })

  it('scopes its query by tenant, organization and entry, and reads only live rows', async () => {
    installTable([])
    await softDeleteSegmentsForEntry(em, ENTRY_ID, SCOPE, new Date())

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.anything(),
      {
        timeEntryId: ENTRY_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        deletedAt: null,
      },
      {},
      SCOPE,
    )
  })
})

describe('restoreSegmentsForEntry', () => {
  it('restores exactly the segments carrying the recorded instant', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const individuallyDeletedAt = new Date('2026-08-26T12:00:00.000Z')
    const cascaded = makeSegment({ id: 'a', deletedAt, endedAt: new Date('2026-08-26T11:00:00.000Z') })
    const individually = makeSegment({ id: 'b', deletedAt: individuallyDeletedAt })
    installTable([cascaded, individually])

    await expect(restoreSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(1)

    expect(cascaded.deletedAt).toBeNull()
    expect(individually.deletedAt).toBe(individuallyDeletedAt)
  })

  it('re-opens only the segments the cascade itself closed', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const preExistingEnd = new Date('2026-08-26T11:00:00.000Z')
    const closedByCascade = makeSegment({ id: 'a', deletedAt, endedAt: deletedAt })
    const alreadyClosed = makeSegment({ id: 'b', deletedAt, endedAt: preExistingEnd })
    installTable([closedByCascade, alreadyClosed])

    await restoreSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)

    expect(closedByCascade.endedAt).toBeNull()
    expect(alreadyClosed.endedAt).toBe(preExistingEnd)
  })

  it('never touches a segment belonging to another organization or tenant', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const inScope = makeSegment({ id: 'a', deletedAt })
    const otherOrg = makeSegment({ id: 'b', organizationId: OTHER_ORG_ID, deletedAt })
    const otherTenant = makeSegment({ id: 'c', tenantId: OTHER_TENANT_ID, deletedAt })
    installTable([inScope, otherOrg, otherTenant])

    await expect(restoreSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(1)

    expect(inScope.deletedAt).toBeNull()
    expect(otherOrg.deletedAt).toBe(deletedAt)
    expect(otherTenant.deletedAt).toBe(deletedAt)
  })

  it('restores nothing when no segment carries the recorded instant', async () => {
    const deletedAt = new Date('2026-08-26T16:42:11.000Z')
    const unrelated = makeSegment({ id: 'a', deletedAt: new Date('2026-08-26T12:00:00.000Z') })
    installTable([unrelated])

    await expect(restoreSegmentsForEntry(em, ENTRY_ID, SCOPE, deletedAt)).resolves.toBe(0)
  })
})
