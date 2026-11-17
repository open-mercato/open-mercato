/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { enrichers } from '../enrichers'

type ExecutedQuery = { sql: string; params: unknown[] }

const PROJECT = 'project-1'

const rollupEnricher = enrichers.find((enricher) => enricher.id === 'staff.timesheets-tasks-rollup')!

function taskRow(
  id: string,
  parentTaskId: string | null,
  minutes: number,
  entryProjectId: string | null = PROJECT,
  isDone = false,
) {
  return {
    task_id: id,
    parent_task_id: parentTaskId,
    task_project_id: PROJECT,
    task_is_done: isDone,
    entry_project_id: entryProjectId,
    minutes: String(minutes),
  }
}

function createContext(rows: unknown[], executed: ExecutedQuery[]): EnricherContext {
  return {
    organizationId: 'org-1',
    tenantId: 'tenant-1',
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

describe('staff.timesheets-tasks-rollup enricher', () => {
  it('targets the task entity so the list route can opt in', () => {
    expect(rollupEnricher.targetEntity).toBe('staff:staff_time_task')
  })

  it('adds ownMinutes, loggedMinutes, childCount and doneChildCount under those exact names', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext(
      [taskRow('parent', null, 90), taskRow('child-a', 'parent', 45, PROJECT, true)],
      executed,
    )

    const [enriched] = await rollupEnricher.enrichMany!([{ id: 'parent', title: 'Parent' }], context)

    expect(enriched).toEqual({
      id: 'parent',
      title: 'Parent',
      ownMinutes: 90,
      loggedMinutes: 135,
      childCount: 1,
      doneChildCount: 1,
    })
  })

  it('publishes doneChildCount from the same aggregate, without a second request', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext(
      [
        taskRow('parent', null, 0),
        taskRow('child-a', 'parent', 0, PROJECT, true),
        taskRow('child-b', 'parent', 0, PROJECT, true),
        taskRow('child-c', 'parent', 0, PROJECT, false),
      ],
      executed,
    )

    const [enriched] = await rollupEnricher.enrichMany!([{ id: 'parent' }], context)

    expect(executed).toHaveLength(1)
    expect(enriched).toMatchObject({ childCount: 3, doneChildCount: 2 })
  })

  it('issues one aggregate for the whole page', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext(
      [taskRow('a', null, 60), taskRow('b', null, 30), taskRow('c', null, 15)],
      executed,
    )

    const results = await rollupEnricher.enrichMany!([{ id: 'a' }, { id: 'b' }, { id: 'c' }], context)

    expect(executed).toHaveLength(1)
    expect(results.map((row) => row.loggedMinutes)).toEqual([60, 30, 15])
  })

  it('scopes the aggregate to the caller tenant and organization', async () => {
    const executed: ExecutedQuery[] = []
    await rollupEnricher.enrichMany!([{ id: 'parent' }], createContext([], executed))

    expect(executed[0].params.slice(0, 2)).toEqual(['tenant-1', 'org-1'])
  })

  it('falls back to zeros for a task the aggregate returned nothing for', async () => {
    const executed: ExecutedQuery[] = []
    const [enriched] = await rollupEnricher.enrichMany!([{ id: 'ghost' }], createContext([], executed))

    expect(enriched).toEqual({ id: 'ghost', ownMinutes: 0, loggedMinutes: 0, childCount: 0, doneChildCount: 0 })
  })

  it('enriches a detail response through enrichOne', async () => {
    const executed: ExecutedQuery[] = []
    const context = createContext([taskRow('parent', null, 20), taskRow('child-a', 'parent', 25)], executed)

    const enriched = await rollupEnricher.enrichOne({ id: 'parent' }, context)

    expect(enriched).toEqual({ id: 'parent', ownMinutes: 20, loggedMinutes: 45, childCount: 1, doneChildCount: 0 })
  })

  it('never touches the database for an empty page', async () => {
    const executed: ExecutedQuery[] = []
    const results = await rollupEnricher.enrichMany!([], createContext([], executed))

    expect(results).toEqual([])
    expect(executed).toHaveLength(0)
  })
})
