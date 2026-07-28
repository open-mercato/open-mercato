/** @jest-environment jsdom */

/**
 * `backend/tasks` is now a BRIDGE route onto the Work Inbox (spec §6.2:
 * "`backend/tasks` redirects to the Work Inbox; instance URLs preserved").
 *
 * Same contract as the Phase-3b form-editor bridges: the file survives, the
 * redirect is immediate, and `page.meta.ts` keeps the RBAC guard it always
 * declared — a bridge that drops its guard is a hole, not a redirect.
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'

const replaceMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import UserTasksListPage from '../page'
import { metadata as tasksMetadata } from '../page.meta'
import { metadata as taskDetailMetadata } from '../[id]/page.meta'
import { WORK_INBOX_HREF } from '../../../lib/work-inbox/navigation'

describe('the retired task list bridges to the Work Inbox', () => {
  beforeEach(() => replaceMock.mockClear())

  test('forwards to the Work Inbox', () => {
    render(<UserTasksListPage />)

    expect(replaceMock).toHaveBeenCalledWith('/backend/work-inbox')
    expect(WORK_INBOX_HREF).toBe('/backend/work-inbox')
    expect(screen.getByText('Opening the work inbox…')).toBeTruthy()
  })

  test('keeps the RBAC guard it declared before the move', () => {
    expect(tasksMetadata.requireAuth).toBe(true)
    expect(tasksMetadata.requireFeatures).toEqual(['workflows.view_tasks'])
  })

  test('hides the retired entry from the sidebar so the inbox is listed once', () => {
    expect(tasksMetadata.navHidden).toBe(true)
  })

  test('task detail urls are untouched — only the list moved', () => {
    expect(taskDetailMetadata.requireAuth).toBe(true)
    expect(taskDetailMetadata.requireFeatures).toEqual(['workflows.view_tasks'])
  })
})
