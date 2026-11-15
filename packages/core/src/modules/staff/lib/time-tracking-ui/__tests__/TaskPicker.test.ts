import { groupTasks, matchesTask, type TaskPickerItem } from '../TaskPicker'

const labels = { recent: 'Recent', noProject: 'No project' }

function task(overrides: Partial<TaskPickerItem> & { id: string }): TaskPickerItem {
  return {
    reference: null,
    title: overrides.id,
    projectId: null,
    projectName: null,
    customerName: null,
    statusId: null,
    assigneeInitials: null,
    assigneeName: null,
    loggedMinutes: null,
    ...overrides,
  }
}

const apolloOne = task({ id: 'a1', reference: 'AWR-6', title: 'Booking flow rebuild', projectId: 'p1', projectName: 'Apollo', customerName: 'Brightside Solar' })
const apolloTwo = task({ id: 'a2', reference: 'AWR-3', title: 'Design system', projectId: 'p1', projectName: 'Apollo', customerName: 'Brightside Solar' })
const atlasOne = task({ id: 'b1', reference: 'ADP-2', title: 'Ingest pipeline', projectId: 'p2', projectName: 'Atlas', customerName: 'Copperleaf' })

describe('matchesTask', () => {
  it('matches on the title', () => {
    expect(matchesTask(apolloOne, 'boo')).toBe(true)
    expect(matchesTask(apolloOne, 'BOOKING')).toBe(true)
  })

  it('matches on the reference, which is how tasks are named out loud', () => {
    expect(matchesTask(apolloOne, 'awr-6')).toBe(true)
    expect(matchesTask(apolloOne, 'AWR')).toBe(true)
  })

  it('does not match an unrelated term', () => {
    expect(matchesTask(apolloOne, 'pipeline')).toBe(false)
  })

  it('treats an empty term as matching everything', () => {
    expect(matchesTask(apolloOne, '   ')).toBe(true)
  })
})

describe('groupTasks', () => {
  it('groups by project and sorts the groups by name', () => {
    const groups = groupTasks([apolloOne, atlasOne, apolloTwo], [], labels)
    expect(groups.map((group) => group.label)).toEqual(['Apollo', 'Atlas'])
    expect(groups[0].sublabel).toBe('Brightside Solar')
    expect(groups[0].items).toHaveLength(2)
  })

  it('puts recents first, in the order given', () => {
    const groups = groupTasks([apolloOne, atlasOne, apolloTwo], ['b1', 'a1'], labels)
    expect(groups[0].label).toBe('Recent')
    expect(groups[0].items.map((item) => item.id)).toEqual(['b1', 'a1'])
  })

  it('still lists a recent task under its own project', () => {
    // Recents are a shortcut, not a move: somebody scanning Apollo should find
    // every Apollo task where they expect it.
    const groups = groupTasks([apolloOne, atlasOne], ['a1'], labels)
    const apollo = groups.find((group) => group.label === 'Apollo')
    expect(apollo?.items.map((item) => item.id)).toContain('a1')
  })

  it('ignores a recent id that is not in the visible set', () => {
    // Filtered out by the search, or no longer accessible.
    const groups = groupTasks([atlasOne], ['a1'], labels)
    expect(groups.map((group) => group.label)).toEqual(['Atlas'])
  })

  it('falls back to a labelled group for a task with no project', () => {
    const groups = groupTasks([task({ id: 'x1', title: 'Loose end' })], [], labels)
    expect(groups[0].label).toBe('No project')
  })
})
