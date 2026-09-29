import {
  MAX_TASK_DEPTH,
  SUBTASK_DEPTH_EXCEEDED_CODE,
  canAcceptChildren,
  planTaskSoftDelete,
  rejectTaskParent,
} from '../taskHierarchy'

const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const PARENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const CHILD_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const SIBLING_ID = 'aaaaaaaa-0000-4000-8000-000000000003'

const topLevel = { id: PARENT_ID, timeProjectId: PROJECT_ID, parentTaskId: null }
const subtask = { id: CHILD_ID, timeProjectId: PROJECT_ID, parentTaskId: PARENT_ID }

describe('rejectTaskParent', () => {
  it('accepts a top-level parent in the same project', () => {
    expect(rejectTaskParent(topLevel, { timeProjectId: PROJECT_ID })).toBeNull()
  })

  it('rejects nesting under a task that is already a subtask', () => {
    expect(rejectTaskParent(subtask, { timeProjectId: PROJECT_ID })).toBe(SUBTASK_DEPTH_EXCEEDED_CODE)
  })

  it('rejects a task that already has children from becoming one', () => {
    expect(rejectTaskParent(topLevel, { id: SIBLING_ID, timeProjectId: PROJECT_ID, childCount: 2 })).toBe(
      SUBTASK_DEPTH_EXCEEDED_CODE,
    )
  })

  it('rejects a task parented to itself', () => {
    expect(rejectTaskParent(topLevel, { id: PARENT_ID, timeProjectId: PROJECT_ID })).toBe('self_parent')
  })

  it('rejects a parent that lives in another project', () => {
    expect(rejectTaskParent(topLevel, { id: SIBLING_ID, timeProjectId: OTHER_PROJECT_ID })).toBe(
      'parent_project_mismatch',
    )
  })

  it('caps the tree at one edge', () => {
    expect(MAX_TASK_DEPTH).toBe(1)
    expect(canAcceptChildren(topLevel)).toBe(true)
    expect(canAcceptChildren(subtask)).toBe(false)
  })
})

describe('planTaskSoftDelete', () => {
  it('takes the live children of a parent with it', () => {
    const plan = planTaskSoftDelete(topLevel, [{ id: CHILD_ID }, { id: SIBLING_ID }])

    expect(plan).toEqual({
      taskId: PARENT_ID,
      childIds: [CHILD_ID, SIBLING_ID],
      allIds: [PARENT_ID, CHILD_ID, SIBLING_ID],
    })
  })

  it('deletes only itself when the task is a subtask', () => {
    const plan = planTaskSoftDelete(subtask, [{ id: SIBLING_ID }])

    expect(plan).toEqual({ taskId: CHILD_ID, childIds: [], allIds: [CHILD_ID] })
  })

  it('never lists a task twice', () => {
    const plan = planTaskSoftDelete(topLevel, [{ id: CHILD_ID }, { id: CHILD_ID }, { id: PARENT_ID }])

    expect(plan.allIds).toEqual([PARENT_ID, CHILD_ID])
  })

  it('has nothing to cascade when the parent stands alone', () => {
    expect(planTaskSoftDelete(topLevel).allIds).toEqual([PARENT_ID])
  })
})
