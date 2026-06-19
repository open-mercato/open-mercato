/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import TimeReportingWidget from '../widget.client'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn(async () => true)
const mockOnSettingsChange = jest.fn()
const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>

function renderWidget() {
  render(
    <TimeReportingWidget
      {...({
        mode: 'view',
        settings: {},
        onSettingsChange: mockOnSettingsChange,
      } as any)}
    />,
  )
}

function mockWidgetReads({ running }: { running: boolean }) {
  mockReadApiResultOrThrow.mockImplementation(async (path: string) => {
    if (path === '/api/staff/timesheets/my-projects?pageSize=100') {
      return { items: [{ time_project_id: 'project-1' }] } as any
    }
    if (path === '/api/staff/timesheets/time-projects?ids=project-1&pageSize=100') {
      return { items: [{ id: 'project-1', name: 'Build', code: 'BLD' }] } as any
    }
    if (path === '/api/staff/team-members/self') {
      return { member: { id: 'staff-1' } } as any
    }
    if (path.startsWith('/api/staff/timesheets/time-entries?')) {
      return {
        items: running
          ? [{
            id: 'entry-1',
            started_at: new Date().toISOString(),
            ended_at: null,
            time_project_id: 'project-1',
          }]
          : [],
      } as any
    }
    return { items: [] } as any
  })
}

describe('TimeReportingWidget guarded mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCall.mockResolvedValue({ ok: true, result: { id: 'entry-1' } } as any)
  })

  it('routes timer create and start through guarded mutation context', async () => {
    mockWidgetReads({ running: false })
    renderWidget()

    fireEvent.change(await screen.findByLabelText('Project'), { target: { value: 'project-1' } })
    fireEvent.change(screen.getByLabelText('Task / Note'), { target: { value: 'Build task' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Timer' }))

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(2))
    expect(mockRunMutation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: 'staff-1',
        staffMemberId: 'staff-1',
        retryLastMutation: mockRetryLastMutation,
      }),
      mutationPayload: expect.objectContaining({
        staffMemberId: 'staff-1',
        timeProjectId: 'project-1',
        source: 'timer',
        notes: 'Build task',
      }),
    }))
    expect(mockRunMutation).toHaveBeenNthCalledWith(2, expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: 'entry-1',
        staffMemberId: 'staff-1',
        retryLastMutation: mockRetryLastMutation,
      }),
      mutationPayload: {
        id: 'entry-1',
        action: 'timer-start',
        staffMemberId: 'staff-1',
      },
    }))
  })

  it('routes timer stop through guarded mutation context', async () => {
    mockWidgetReads({ running: true })
    renderWidget()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop Timer' }))

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'staff.timesheets.time_entry',
        resourceId: 'entry-1',
        staffMemberId: 'staff-1',
        retryLastMutation: mockRetryLastMutation,
      }),
      mutationPayload: {
        id: 'entry-1',
        action: 'timer-stop',
        staffMemberId: 'staff-1',
      },
    }))
  })
})
