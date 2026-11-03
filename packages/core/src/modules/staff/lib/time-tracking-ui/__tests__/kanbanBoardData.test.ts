import {
  columnLoggedMinutes,
  computeSubtaskProgress,
  formatBoardMinutes,
  initialsFromName,
  nextPositionAtColumnTop,
  sortByPosition,
  toBoardStatus,
  toBoardTask,
  type BoardTask,
} from '../kanbanBoardData'

function task(overrides: Partial<BoardTask> & { id: string }): BoardTask {
  return {
    title: 'Task',
    reference: null,
    timeProjectId: 'project-1',
    parentTaskId: null,
    taskStatusId: 'status-1',
    assigneeStaffMemberId: null,
    position: 1000,
    ownMinutes: 0,
    loggedMinutes: 0,
    childCount: 0,
    closedAt: null,
    updatedAt: null,
    tagIds: [],
    ...overrides,
  }
}

describe('toBoardStatus', () => {
  it('reads both snake_case and camelCase flags', () => {
    expect(toBoardStatus({ id: 's1', name: 'W toku', is_done: true, position: 2000 })).toEqual({
      id: 's1',
      name: 'W toku',
      slug: null,
      color: null,
      position: 2000,
      isDefault: false,
      isDone: true,
    })
    expect(toBoardStatus({ id: 's2', name: 'Done', isDone: true })?.isDone).toBe(true)
  })

  it('drops a row with no id', () => {
    expect(toBoardStatus({ name: 'Nameless' })).toBeNull()
  })
})

describe('toBoardTask', () => {
  it('carries the rollup fields the enricher adds', () => {
    const parsed = toBoardTask({
      id: 't1',
      title: 'Migracja koszyka B2B',
      task_status_id: 's1',
      ownMinutes: 60,
      loggedMinutes: 1365,
      childCount: 5,
      updated_at: '2026-08-12T10:00:00.000Z',
    })
    expect(parsed).toMatchObject({
      id: 't1',
      taskStatusId: 's1',
      ownMinutes: 60,
      loggedMinutes: 1365,
      childCount: 5,
      updatedAt: '2026-08-12T10:00:00.000Z',
    })
  })
})

describe('columnLoggedMinutes', () => {
  it('sums top-level cards', () => {
    expect(columnLoggedMinutes([task({ id: 'a', loggedMinutes: 45 }), task({ id: 'b', loggedMinutes: 30 })])).toBe(75)
  })

  it('never adds a child whose parent is in the same set (risk R10)', () => {
    const rows = [
      task({ id: 'parent', loggedMinutes: 100 }),
      task({ id: 'child', parentTaskId: 'parent', loggedMinutes: 40 }),
    ]
    expect(columnLoggedMinutes(rows)).toBe(100)
  })
})

describe('formatBoardMinutes', () => {
  it('renders the mockup clock format', () => {
    expect(formatBoardMinutes(1365)).toBe('22:45')
    expect(formatBoardMinutes(0)).toBe('0:00')
    expect(formatBoardMinutes(355)).toBe('5:55')
  })
})

describe('computeSubtaskProgress', () => {
  it('counts a child done by its column, or by closedAt when the column is off the board', () => {
    const children = [
      task({ id: 'c1', parentTaskId: 'p1', taskStatusId: 'done' }),
      task({ id: 'c2', parentTaskId: 'p1', taskStatusId: 'wip' }),
      task({ id: 'c3', parentTaskId: 'p1', taskStatusId: 'archived', closedAt: '2026-08-01T00:00:00.000Z' }),
    ]
    expect(computeSubtaskProgress(children, new Set(['done'])).get('p1')).toEqual({ total: 3, done: 2 })
  })

  it('ignores rows without a parent', () => {
    expect(computeSubtaskProgress([task({ id: 'orphan' })], new Set()).size).toBe(0)
  })
})

describe('nextPositionAtColumnTop', () => {
  it('halves the lowest position so the card lands above every card in the column', () => {
    expect(nextPositionAtColumnTop([task({ id: 'a', position: 1000 })])).toBe(500)
  })

  it('seeds an empty column on the gap grid', () => {
    expect(nextPositionAtColumnTop([])).toBe(1000)
  })

  it('never returns zero when the grid is exhausted', () => {
    expect(nextPositionAtColumnTop([task({ id: 'a', position: 1 })])).toBe(1)
  })
})

describe('initialsFromName', () => {
  it('builds the mockup avatar chips', () => {
    expect(initialsFromName('Anna Nowak')).toBe('AN')
    expect(initialsFromName('Paulina')).toBe('PA')
    expect(initialsFromName(null)).toBe('?')
  })
})

describe('sortByPosition', () => {
  it('orders by position and breaks ties on id so the board never flickers', () => {
    const rows = [
      task({ id: 'b', position: 1000 }),
      task({ id: 'a', position: 1000 }),
      task({ id: 'c', position: 500 }),
    ]
    expect(sortByPosition(rows).map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })
})
