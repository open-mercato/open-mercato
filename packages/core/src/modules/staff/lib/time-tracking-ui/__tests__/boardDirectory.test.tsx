/** @jest-environment jsdom */
import * as React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAssigneeNames, useStaffMemberDirectory } from '../boardDirectory'

let mockFeatures: string[] | undefined
let mockScope = 1
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockFeatures } }),
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScope,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const mockApiCall = jest.mocked(apiCall)
const taskRows = [{ id: 'task-a', assignee_staff_member_id: 'member-a', _staff: { assigneeName: 'Assigned employee' } }]

function wrapperFor(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockFeatures = ['staff.timesheets.tasks.view', 'staff.timesheets.tasks.manage']
  mockScope = 1
  mockApiCall.mockReset()
  mockApiCall.mockImplementation(async (url) => {
    if (url === '/api/staff/team-members/self') {
      return { ok: true, status: 200, result: { member: { id: 'self', displayName: 'Own employee' } } } as Awaited<ReturnType<typeof apiCall>>
    }
    return { ok: true, status: 200, result: { items: [{ id: 'member-a', display_name: 'Directory employee' }] } } as Awaited<ReturnType<typeof apiCall>>
  })
})

test('permitted employee uses authorized task names and own profile without requesting the staff directory', async () => {
  const { result } = renderHook(() => useAssigneeNames(['member-a', 'self'], taskRows), { wrapper: wrapperFor() })
  await waitFor(() => expect(result.current.data?.get('self')).toBe('Own employee'))
  expect(result.current.data?.get('member-a')).toBe('Assigned employee')
  expect(mockApiCall.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/team-members?'))).toEqual([])
})

test.each(['staff.view', 'staff.*', '*'])('directory-capable manager retains name lookup with %s', async (feature) => {
  mockFeatures = [feature]
  const { result } = renderHook(() => useAssigneeNames(['member-a', 'member-a'], taskRows), { wrapper: wrapperFor() })
  await waitFor(() => expect(result.current.data?.get('member-a')).toBe('Directory employee'))
  expect(mockApiCall.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/team-members?'))).toHaveLength(1)
  expect(mockApiCall).toHaveBeenCalledWith('/api/staff/team-members?ids=member-a&pageSize=100')
})

test('directory capability removal cannot reuse manager-only cached names', async () => {
  mockFeatures = ['staff.view']
  const { result, rerender } = renderHook(() => useAssigneeNames(['member-a'], taskRows), { wrapper: wrapperFor() })
  await waitFor(() => expect(result.current.data?.get('member-a')).toBe('Directory employee'))
  mockFeatures = []
  rerender()
  expect(result.current.data?.get('member-a')).toBe('Assigned employee')
})

test('new organization and project rows replace the previous authorized task names', async () => {
  const { result, rerender } = renderHook(({ rows }) => useAssigneeNames(['member-a'], rows), {
    initialProps: { rows: taskRows }, wrapper: wrapperFor(),
  })
  await waitFor(() => expect(result.current.data?.get('member-a')).toBe('Assigned employee'))
  mockScope = 2
  rerender({ rows: [] })
  expect(result.current.data?.has('member-a')).toBe(false)
})

test('an unresolved capability payload does not start a directory request', () => {
  mockFeatures = undefined
  renderHook(() => useAssigneeNames(['member-a'], taskRows), { wrapper: wrapperFor() })
  expect(mockApiCall.mock.calls.filter(([url]) => String(url).startsWith('/api/staff/team-members?'))).toEqual([])
})

test('employee opening the assignee filter does not request the restricted directory', () => {
  renderHook(() => useStaffMemberDirectory(true), { wrapper: wrapperFor() })
  expect(mockApiCall).not.toHaveBeenCalled()
})

test('manager opening the assignee filter retains directory names', async () => {
  mockFeatures = ['staff.*']
  const { result } = renderHook(() => useStaffMemberDirectory(true), { wrapper: wrapperFor() })
  await waitFor(() => expect(result.current.data).toEqual([{ id: 'member-a', displayName: 'Directory employee' }]))
})

test('unexpected manager directory errors remain query errors', async () => {
  mockFeatures = ['staff.view']
  mockApiCall.mockRejectedValue(new Error('[internal] directory unavailable'))
  const { result } = renderHook(() => useAssigneeNames(['member-a'], taskRows), { wrapper: wrapperFor() })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('[internal] directory unavailable')
})
