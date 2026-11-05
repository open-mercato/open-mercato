/** @jest-environment node */
// T3.10 (a) — tags on task rows.
//
// The assignment route only writes, so before this enricher a tag on a task was
// invisible to every reader: the board rendered no chip and the drawer could add
// a tag it could never show or remove. Two properties are pinned here because
// both fail silently:
//
//  1. `tagIds` lands under that exact name — the board and the drawer already
//     read it and resolve the labels once per page — and one join answers the
//     whole page, never one lookup per card.
//  2. The join is scoped by tenant and organization, and keyed by the page's own
//     task ids. The list route has already intersected that page with
//     `resolveProjectAccess`, so a tag can only be read through a task the caller
//     may already see.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers } from '../enrichers'

type ExecutedQuery = { sql: string; params: unknown[] }

const TAG_A = 'tag-a'
const TAG_B = 'tag-b'

const tagEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-tasks-tags')!

function tagRow(taskId: string, tagId: string, label: string, color: string | null = null) {
  return { task_id: taskId, tag_id: tagId, slug: label, label, color }
}

function createContext(
  rows: unknown[],
  executed: ExecutedQuery[],
  scope: { tenantId?: string; organizationId?: string } = {},
): EnricherContext {
  return {
    organizationId: scope.organizationId ?? 'org-1',
    tenantId: scope.tenantId ?? 'tenant-1',
    userId: 'user-1',
    em: {
      fork: () => ({
        getConnection: () => ({
          execute: async (sql: string, params: unknown[]) => {
            executed.push({ sql, params })
            return rows
          },
        }),
      }),
    },
    container: { resolve: () => undefined },
  } as unknown as EnricherContext
}

describe('staff.timesheets-tasks-tags enricher', () => {
  it('targets the task entity so the list route can opt in', () => {
    expect(tagEnricher.targetEntity).toBe('staff:staff_time_task')
  })

  it('adds tagIds under that exact name, with the label and colour beside it', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext(
      [tagRow('task-1', TAG_A, 'rozwój', '#123456'), tagRow('task-1', TAG_B, 'wsparcie', null)],
      executed,
    )

    const [enriched] = await tagEnricher.enrichMany!([{ id: 'task-1', title: 'Task' }], context)

    expect(enriched).toEqual({
      id: 'task-1',
      title: 'Task',
      tagIds: [TAG_A, TAG_B],
      tags: [
        { id: TAG_A, slug: 'rozwój', label: 'rozwój', color: '#123456' },
        { id: TAG_B, slug: 'wsparcie', label: 'wsparcie', color: null },
      ],
    })
  })

  it('issues one join for the whole page and routes every row to its own task', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext(
      [tagRow('task-1', TAG_A, 'rozwój'), tagRow('task-3', TAG_B, 'wsparcie')],
      executed,
    )

    const results = await tagEnricher.enrichMany!([{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }], context)

    expect(executed).toHaveLength(1)
    expect(results.map((row) => row.tagIds)).toEqual([[TAG_A], [], [TAG_B]])
  })

  it('scopes the join to the caller tenant and organization and to the page ids', async () => {
    const executed: ExecutedQuery[] = []
    await tagEnricher.enrichMany!([{ id: 'task-1' }, { id: 'task-2' }], createContext([], executed))

    const { sql, params } = executed[0]
    expect(sql).toContain('tt.tenant_id = ?')
    expect(sql).toContain('tt.organization_id = ?')
    expect(sql).toContain('tg.tenant_id = tt.tenant_id')
    expect(sql).toContain('tg.organization_id = tt.organization_id')
    // A soft-deleted tag is not a tag any more, so it never reaches a card.
    expect(sql).toContain('tg.deleted_at IS NULL')
    expect(params).toEqual(['tenant-1', 'org-1', 'task-1', 'task-2'])
  })

  it('never lets a row the query did not ask about attach itself to a page task', async () => {
    const executed: ExecutedQuery[] = []
    // The tenant predicate lives in SQL; this guards the mapping layer against
    // ever widening a task's chips with an assignment from elsewhere.
    const context = createContext([tagRow('foreign-task', TAG_A, 'rozwój')], executed)

    const [enriched] = await tagEnricher.enrichMany!([{ id: 'task-1' }], context)

    expect(enriched.tagIds).toEqual([])
    expect(enriched.tags).toEqual([])
  })

  it('deduplicates a tag the join returned more than once', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext([tagRow('task-1', TAG_A, 'rozwój'), tagRow('task-1', TAG_A, 'rozwój')], executed)

    const [enriched] = await tagEnricher.enrichMany!([{ id: 'task-1' }], context)

    expect(enriched.tagIds).toEqual([TAG_A])
  })

  it('gives an untagged task an empty list rather than an absent key', async () => {
    const executed: ExecutedQuery[] = []
    const [enriched] = await tagEnricher.enrichMany!([{ id: 'task-1' }], createContext([], executed))

    expect(enriched).toEqual({ id: 'task-1', tagIds: [], tags: [] })
  })

  it('enriches a detail response through enrichOne', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext([tagRow('task-1', TAG_A, 'rozwój')], executed)

    const enriched = await tagEnricher.enrichOne({ id: 'task-1' }, context)

    expect(enriched.tagIds).toEqual([TAG_A])
  })

  it('never touches the database for an empty page', async () => {
    const executed: ExecutedQuery[] = []
    const results = await tagEnricher.enrichMany!([], createContext([], executed))

    expect(results).toEqual([])
    expect(executed).toHaveLength(0)
  })

  it('returns empty chips instead of querying when the request carries no tenant scope', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext([tagRow('task-1', TAG_A, 'rozwój')], executed, {
      tenantId: '',
      organizationId: '',
    })

    const [enriched] = await tagEnricher.enrichMany!([{ id: 'task-1' }], context)

    expect(executed).toHaveLength(0)
    expect(enriched).toEqual({ id: 'task-1', tagIds: [], tags: [] })
  })
})
