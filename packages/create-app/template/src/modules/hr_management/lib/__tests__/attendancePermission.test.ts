/** @jest-environment node */
/**
 * Pins the lateness permission's two contracts.
 *
 * The first is with the approval engine: `entityType` is the string it matches to know what it is
 * approving, and it is the only thing tying a submitted request back to an attendance record — a typo
 * here produces a request that approves nothing while every screen still looks correct. The second is
 * with the operator: only a `late` record can be excused, because approving a request about any other
 * status changes nothing and reads as a broken button.
 */
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  fetchCrudList: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
}))

import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import {
  APPROVAL_SUBMIT_ENDPOINT,
  ATTENDANCE_APPROVAL_ENTITY_TYPE,
  findPendingApprovalRequest,
  isLatenessPermissionEligible,
  submitAttendanceForApproval,
} from '../attendancePermission'

const fetchCrudListMock = fetchCrudList as jest.MockedFunction<typeof fetchCrudList>
const apiCallOrThrowMock = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>

const ATTENDANCE_ID = '00000000-0000-4000-8000-0000000000a1'
const WORKFLOW_ID = '00000000-0000-4000-8000-0000000000b2'

beforeEach(() => {
  fetchCrudListMock.mockReset()
  apiCallOrThrowMock.mockReset()
})

describe('isLatenessPermissionEligible', () => {
  it('offers the action for a recorded lateness', () => {
    expect(isLatenessPermissionEligible('late')).toBe(true)
  })

  it('does not offer it for a status the engine would not change', () => {
    for (const status of ['present', 'absent', 'on_leave', 'holiday', 'LATE', '', null, undefined]) {
      expect(isLatenessPermissionEligible(status)).toBe(false)
    }
  })
})

describe('findPendingApprovalRequest', () => {
  it('asks for the pending request of one record, using the column-named entity filters', async () => {
    fetchCrudListMock.mockResolvedValue({ items: [{ id: 'request-1' }] })

    const found = await findPendingApprovalRequest(ATTENDANCE_ID)

    expect(found).toBe('request-1')
    expect(fetchCrudListMock).toHaveBeenCalledWith('hr_management/approval-requests', {
      entityType: ATTENDANCE_APPROVAL_ENTITY_TYPE,
      entityId: ATTENDANCE_ID,
      status: 'pending',
      pageSize: 1,
    })
  })

  it('reports no request when the record has none', async () => {
    fetchCrudListMock.mockResolvedValue({ items: [] })
    expect(await findPendingApprovalRequest(ATTENDANCE_ID)).toBeNull()
  })

  it('reports no request when the list response carries no items array', async () => {
    fetchCrudListMock.mockResolvedValue({} as never)
    expect(await findPendingApprovalRequest(ATTENDANCE_ID)).toBeNull()
  })
})

describe('submitAttendanceForApproval', () => {
  it('posts the workflow and the engine entity type to the submit route', async () => {
    apiCallOrThrowMock.mockResolvedValue({} as never)

    await submitAttendanceForApproval(WORKFLOW_ID, ATTENDANCE_ID)

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = apiCallOrThrowMock.mock.calls[0]
    expect(endpoint).toBe(APPROVAL_SUBMIT_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      workflowId: WORKFLOW_ID,
      entityType: 'hr_attendance_record',
      entityId: ATTENDANCE_ID,
    })
  })

  it('keeps the entity type the engine expects', () => {
    expect(ATTENDANCE_APPROVAL_ENTITY_TYPE).toBe('hr_attendance_record')
  })

  it('surfaces a rejected submission instead of swallowing it', async () => {
    apiCallOrThrowMock.mockRejectedValue(new Error('[internal] submit failed'))
    await expect(submitAttendanceForApproval(WORKFLOW_ID, ATTENDANCE_ID)).rejects.toThrow('submit failed')
  })
})
