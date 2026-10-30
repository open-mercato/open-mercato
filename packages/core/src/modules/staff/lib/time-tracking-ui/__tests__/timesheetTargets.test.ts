// T5.4 — "rows can be project or project + task". The row key is the whole
// mechanism, so it is pinned here: it must round-trip, and it must keep a
// project row and a task row of the same project distinguishable.

import {
  buildLogTargets,
  buildTargetKey,
  parseTargetKey,
  projectTarget,
  targetLabel,
  taskTarget,
} from '../timesheetTargets'

const PROJECT = { id: 'p1', name: 'Nordvik — B2B', code: 'NORDVIK', color: 'blue' }
const OTHER = { id: 'p2', name: 'Ambra', code: 'AMBRA', color: null }

describe('target keys', () => {
  it('round-trips a project row and a task row', () => {
    expect(parseTargetKey(buildTargetKey('p1', null))).toEqual({ timeProjectId: 'p1', taskId: null })
    expect(parseTargetKey(buildTargetKey('p1', 't1'))).toEqual({ timeProjectId: 'p1', taskId: 't1' })
  })

  it('keeps the project row and its task rows distinct', () => {
    expect(buildTargetKey('p1', null)).not.toBe(buildTargetKey('p1', 't1'))
  })
})

describe('buildLogTargets', () => {
  it('lists each project followed by its own tasks and drops tasks of unknown projects', () => {
    const targets = buildLogTargets(
      [PROJECT, OTHER],
      [
        { id: 't1', title: 'Cart', timeProjectId: 'p1' },
        { id: 't2', title: 'Orphan', timeProjectId: 'p-missing' },
      ],
    )
    expect(targets.map((target) => target.key)).toEqual(['p1', 'p1:t1', 'p2'])
    expect(targets[1].projectName).toBe('Nordvik — B2B')
    expect(targets[1].taskTitle).toBe('Cart')
  })

  it('labels a task row with its project', () => {
    expect(targetLabel(projectTarget(PROJECT))).toBe('Nordvik — B2B')
    expect(targetLabel(taskTarget(PROJECT, { id: 't1', title: 'Cart', timeProjectId: 'p1' }))).toBe(
      'Nordvik — B2B · Cart',
    )
  })
})
