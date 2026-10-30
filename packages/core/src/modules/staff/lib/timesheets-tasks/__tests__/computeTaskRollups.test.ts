import type { EntityManager } from '@mikro-orm/postgresql'
import {
  computeTaskRollups,
  summarizeTaskRollups,
  type TaskRollupEntryGroup,
  type TaskRollupTaskRow,
} from '../computeTaskRollups'

const PROJECT = 'project-1'
const OTHER_PROJECT = 'project-2'

function task(id: string, overrides: Partial<TaskRollupTaskRow> = {}): TaskRollupTaskRow {
  return { id, parentTaskId: null, timeProjectId: PROJECT, deletedAt: null, ...overrides }
}

function entries(taskId: string, minutes: number, overrides: Partial<TaskRollupEntryGroup> = {}): TaskRollupEntryGroup {
  return { taskId, timeProjectId: PROJECT, minutes, deletedAt: null, ...overrides }
}

describe('summarizeTaskRollups', () => {
  it('rolls a parent up to own plus children while keeping own minutes separate', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent', 'child-a', 'child-b'],
      tasks: [task('parent'), task('child-a', { parentTaskId: 'parent' }), task('child-b', { parentTaskId: 'parent' })],
      entryGroups: [entries('parent', 90), entries('child-a', 45), entries('child-b', 30)],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 165, childCount: 2, doneChildCount: 0 })
  })

  it('reports loggedMinutes equal to ownMinutes for a childless task', () => {
    const result = summarizeTaskRollups({
      taskIds: ['solo'],
      tasks: [task('solo')],
      entryGroups: [entries('solo', 75)],
    })

    const rollup = result.get('solo')
    expect(rollup).toEqual({ ownMinutes: 75, loggedMinutes: 75, childCount: 0, doneChildCount: 0 })
    expect(rollup?.loggedMinutes).toBe(rollup?.ownMinutes)
  })

  it('reports a child in isolation with only its own minutes', () => {
    const result = summarizeTaskRollups({
      taskIds: ['child-a'],
      tasks: [task('child-a', { parentTaskId: 'parent' }), task('parent')],
      entryGroups: [entries('parent', 90), entries('child-a', 45)],
    })

    expect(result.get('child-a')).toEqual({ ownMinutes: 45, loggedMinutes: 45, childCount: 0, doneChildCount: 0 })
  })

  it('rolls up children that are absent from the page', () => {
    // The board asks for top-level cards only, so the children are never on the page.
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [task('parent'), task('child-a', { parentTaskId: 'parent' }), task('child-b', { parentTaskId: 'parent' })],
      entryGroups: [entries('parent', 90), entries('child-a', 45), entries('child-b', 30)],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 165, childCount: 2, doneChildCount: 0 })
  })

  it('excludes soft-deleted children from the rollup and from childCount', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent' }),
        task('child-gone', { parentTaskId: 'parent', deletedAt: new Date() }),
      ],
      entryGroups: [entries('parent', 90), entries('child-a', 45), entries('child-gone', 600)],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 135, childCount: 1, doneChildCount: 0 })
  })

  it('excludes soft-deleted entry groups', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [task('parent'), task('child-a', { parentTaskId: 'parent' })],
      entryGroups: [
        entries('parent', 90),
        entries('parent', 500, { deletedAt: new Date() }),
        entries('child-a', 45),
        entries('child-a', 300, { deletedAt: new Date() }),
      ],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 135, childCount: 1, doneChildCount: 0 })
  })

  it('excludes entries booked on a project outside the page', () => {
    // The page is already intersected with the caller's project access, so a project
    // it does not contain is not provably visible — its minutes stay out.
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [task('parent'), task('child-a', { parentTaskId: 'parent' })],
      entryGroups: [
        entries('parent', 90),
        entries('parent', 999, { timeProjectId: OTHER_PROJECT }),
        entries('child-a', 45),
        entries('child-a', 777, { timeProjectId: OTHER_PROJECT }),
      ],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 135, childCount: 1, doneChildCount: 0 })
  })

  it('keeps entries whose project is unset, since they belong to a visible task', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [task('parent')],
      entryGroups: [entries('parent', 20, { timeProjectId: null })],
    })

    expect(result.get('parent')?.ownMinutes).toBe(20)
  })

  it('counts a child once when the aggregate returns it in several groups', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent' }),
        task('child-a', { parentTaskId: 'parent' }),
      ],
      entryGroups: [entries('parent', 60), entries('child-a', 30), entries('child-a', 15)],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 60, loggedMinutes: 105, childCount: 1, doneChildCount: 0 })
  })

  it('returns zeros for a task the aggregate produced no row for', () => {
    const result = summarizeTaskRollups({ taskIds: ['ghost'], tasks: [], entryGroups: [] })

    expect(result.get('ghost')).toEqual({ ownMinutes: 0, loggedMinutes: 0, childCount: 0, doneChildCount: 0 })
  })

  it('counts only the children whose status is flagged done', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-done', { parentTaskId: 'parent', isDone: true }),
        task('child-open', { parentTaskId: 'parent', isDone: false }),
        task('child-unstatused', { parentTaskId: 'parent' }),
      ],
      entryGroups: [],
    })

    expect(result.get('parent')).toMatchObject({ childCount: 3, doneChildCount: 1 })
  })

  it('counts done children that are absent from the page', () => {
    // The board asks for top-level cards, so `3/5` is only ever computable from
    // children the page does not contain.
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent', isDone: true }),
        task('child-b', { parentTaskId: 'parent', isDone: true }),
        task('child-c', { parentTaskId: 'parent', isDone: false }),
      ],
      entryGroups: [],
    })

    expect(result.get('parent')).toMatchObject({ childCount: 3, doneChildCount: 2 })
  })

  it('excludes a soft-deleted done child from both counts', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent', isDone: true }),
        task('child-gone', { parentTaskId: 'parent', isDone: true, deletedAt: new Date() }),
      ],
      entryGroups: [],
    })

    expect(result.get('parent')).toMatchObject({ childCount: 1, doneChildCount: 1 })
  })

  it('never counts a done grandchild or an unrelated done task as this task\'s child', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent', isDone: false }),
        task('grandchild', { parentTaskId: 'child-a', isDone: true }),
        task('stranger', { isDone: true }),
      ],
      entryGroups: [],
    })

    expect(result.get('parent')).toMatchObject({ childCount: 1, doneChildCount: 0 })
  })

  it('counts a done child once when the aggregate returns it in several groups', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [
        task('parent'),
        task('child-a', { parentTaskId: 'parent', isDone: true }),
        task('child-a', { parentTaskId: 'parent', isDone: true }),
      ],
      entryGroups: [entries('child-a', 30), entries('child-a', 15)],
    })

    expect(result.get('parent')).toMatchObject({ childCount: 1, doneChildCount: 1 })
  })

  it('never lets an unrelated task leak into a rollup', () => {
    const result = summarizeTaskRollups({
      taskIds: ['parent'],
      tasks: [task('parent'), task('other')],
      entryGroups: [entries('parent', 60), entries('other', 480)],
    })

    expect(result.get('parent')).toEqual({ ownMinutes: 60, loggedMinutes: 60, childCount: 0, doneChildCount: 0 })
  })
})

type ExecutedQuery = { sql: string; params: unknown[] }

function fakeEm(rows: unknown[], executed: ExecutedQuery[]): EntityManager {
  return {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        executed.push({ sql, params })
        return rows
      },
    }),
  } as unknown as EntityManager
}

describe('computeTaskRollups', () => {
  it('runs one aggregate for the whole page and maps its rows onto every task', async () => {
    const executed: ExecutedQuery[] = []
    const em = fakeEm(
      [
        { task_id: 'parent', parent_task_id: null, task_project_id: PROJECT, entry_project_id: PROJECT, minutes: '90' },
        {
          task_id: 'child-a',
          parent_task_id: 'parent',
          task_project_id: PROJECT,
          entry_project_id: PROJECT,
          minutes: '45',
        },
        { task_id: 'solo', parent_task_id: null, task_project_id: PROJECT, entry_project_id: null, minutes: '0' },
      ],
      executed,
    )

    const result = await computeTaskRollups({
      em,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      taskIds: ['parent', 'solo'],
    })

    expect(executed).toHaveLength(1)
    expect(result.get('parent')).toEqual({ ownMinutes: 90, loggedMinutes: 135, childCount: 1, doneChildCount: 0 })
    expect(result.get('solo')).toEqual({ ownMinutes: 0, loggedMinutes: 0, childCount: 0, doneChildCount: 0 })
  })

  it('widens the aggregate to children that are not on the page', async () => {
    const executed: ExecutedQuery[] = []
    await computeTaskRollups({
      em: fakeEm([], executed),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      taskIds: ['parent'],
    })

    expect(executed[0].sql).toContain('t.parent_task_id IN')
    expect(executed[0].params).toEqual(['tenant-1', 'org-1', 'parent', 'parent'])
  })

  it('scopes both tables by tenant and organization and skips soft-deleted rows', async () => {
    const executed: ExecutedQuery[] = []
    await computeTaskRollups({
      em: fakeEm([], executed),
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      taskIds: ['parent'],
    })

    const { sql, params } = executed[0]
    expect(sql).toContain('t.tenant_id = ?')
    expect(sql).toContain('t.organization_id = ?')
    expect(sql).toContain('e.tenant_id = t.tenant_id')
    expect(sql).toContain('e.organization_id = t.organization_id')
    expect(sql).toContain('t.deleted_at IS NULL')
    expect(sql).toContain('e.deleted_at IS NULL')
    expect(params.slice(0, 2)).toEqual(['tenant-1', 'org-1'])
  })

  it('drops a row from another tenant that the aggregate could never have returned', async () => {
    const executed: ExecutedQuery[] = []
    // The tenant predicate lives in SQL; this guards the mapping layer against ever
    // widening a rollup with a task the query did not scope in.
    const em = fakeEm(
      [{ task_id: 'parent', parent_task_id: null, task_project_id: PROJECT, entry_project_id: PROJECT, minutes: '90' }],
      executed,
    )

    const result = await computeTaskRollups({
      em,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      taskIds: ['parent', 'foreign-task'],
    })

    expect(result.get('foreign-task')).toEqual({ ownMinutes: 0, loggedMinutes: 0, childCount: 0, doneChildCount: 0 })
  })

  it('reads done-ness from the status column inside the same aggregate', async () => {
    const executed: ExecutedQuery[] = []
    const em = fakeEm(
      [
        {
          task_id: 'parent',
          parent_task_id: null,
          task_project_id: PROJECT,
          task_is_done: false,
          entry_project_id: null,
          minutes: '0',
        },
        {
          task_id: 'child-done',
          parent_task_id: 'parent',
          task_project_id: PROJECT,
          task_is_done: true,
          entry_project_id: null,
          minutes: '0',
        },
        {
          // Some drivers hand a boolean back as the Postgres text form.
          task_id: 'child-done-text',
          parent_task_id: 'parent',
          task_project_id: PROJECT,
          task_is_done: 't',
          entry_project_id: null,
          minutes: '0',
        },
        {
          task_id: 'child-open',
          parent_task_id: 'parent',
          task_project_id: PROJECT,
          task_is_done: null,
          entry_project_id: null,
          minutes: '0',
        },
      ],
      executed,
    )

    const result = await computeTaskRollups({
      em,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      taskIds: ['parent'],
    })

    expect(executed).toHaveLength(1)
    expect(executed[0].sql).toContain('staff_time_task_statuses')
    expect(executed[0].sql).toContain('s.tenant_id = t.tenant_id')
    expect(executed[0].sql).toContain('s.organization_id = t.organization_id')
    expect(result.get('parent')).toMatchObject({ childCount: 3, doneChildCount: 2 })
  })

  it('deduplicates the requested ids and issues no query for an empty page', async () => {
    const executed: ExecutedQuery[] = []
    const em = fakeEm([], executed)

    await computeTaskRollups({ em, tenantId: 'tenant-1', organizationId: 'org-1', taskIds: ['a', 'a', 'b'] })
    expect(executed[0].params).toEqual(['tenant-1', 'org-1', 'a', 'b', 'a', 'b'])

    const empty = await computeTaskRollups({ em, tenantId: 'tenant-1', organizationId: 'org-1', taskIds: [] })
    expect(empty.size).toBe(0)
    expect(executed).toHaveLength(1)
  })
})
