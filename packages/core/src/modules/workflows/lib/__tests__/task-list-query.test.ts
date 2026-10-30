/** @jest-environment node */

/**
 * The inbox defaults its view filter to `myTasks: 'true'` but used to forward
 * only `status`/`overdue`/`workflowInstanceId`, so the default "My Tasks" view
 * listed every task in the organization while claiming otherwise.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTaskListQueryParams } from '../task-list-query'

const PAGINATION = { limit: 50, offset: 0 }

describe('buildTaskListQueryParams', () => {
  test('forwards the my-tasks filter the inbox defaults to', () => {
    const params = buildTaskListQueryParams({ myTasks: 'true' }, PAGINATION)
    expect(params.get('myTasks')).toBe('true')
  })

  test('omits the my-tasks filter when the author switched to all tasks', () => {
    const params = buildTaskListQueryParams({ myTasks: '' }, PAGINATION)
    expect(params.has('myTasks')).toBe(false)
  })

  test('keeps forwarding every filter the page already sent', () => {
    const params = buildTaskListQueryParams(
      {
        status: 'PENDING',
        overdue: 'true',
        workflowInstanceId: 'instance-1',
        myTasks: 'true',
      },
      { limit: 25, offset: 50 },
    )

    expect(Object.fromEntries(params.entries())).toEqual({
      limit: '25',
      offset: '50',
      status: 'PENDING',
      overdue: 'true',
      workflowInstanceId: 'instance-1',
      myTasks: 'true',
    })
  })

  test('drops empty and non-string filter values', () => {
    const params = buildTaskListQueryParams(
      { status: '', workflowInstanceId: undefined, overdue: false },
      PAGINATION,
    )
    expect(Object.fromEntries(params.entries())).toEqual({ limit: '50', offset: '0' })
  })
})

/**
 * The inbox surface moved to `backend/work-inbox` (the task list is now a bridge
 * redirect), but the rule it was guarding did not: the page must forward every
 * filter it offers through the shared builder, never an inline subset — a page
 * that forwards a subset silently claims a narrowing it never asked for.
 */
describe('work inbox page', () => {
  const pageSource = readFileSync(
    join(__dirname, '..', '..', 'backend', 'work-inbox', 'page.tsx'),
    'utf8',
  )

  test('builds its request through the shared builder instead of an inline subset', () => {
    expect(pageSource).toContain('buildWorkInboxListQueryParams(filterValues')
    expect(pageSource).not.toContain("params.set('status'")
  })
})
