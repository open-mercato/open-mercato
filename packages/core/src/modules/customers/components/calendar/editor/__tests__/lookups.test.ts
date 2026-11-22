import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchAssignableStaffMembers } from '../../../../lib/assignableStaff'
import { searchPeopleOptions } from '../lookups'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('../../../../lib/assignableStaff', () => ({ fetchAssignableStaffMembers: jest.fn() }))

const customer = { userId: '03790211-3afc-4af8-be5d-5c96abc05ab7', name: 'Customer contact', email: 'contact@example.org', isCustomer: true }

beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [
    { id: customer.userId, display_name: customer.name, primary_email: customer.email },
  ] })
})

it('uses customer display_name and staff displayName instead of recipient record IDs', async () => {
  jest.mocked(fetchAssignableStaffMembers).mockResolvedValue([
    { teamMemberId: 'member-id', userId: 'user-id', displayName: 'Alex Chen', email: null, teamName: null },
  ])
  const signal = new AbortController().signal
  expect(await searchPeopleOptions(' Alex ', { includeCustomers: true, activeOrgId: 'org-1', signal })).toEqual({
    options: [{ userId: 'user-id', name: 'Alex Chen', email: null, isCustomer: false }, customer],
    staffLoadFailed: false, customerLoadFailed: false,
  })
  expect(fetchAssignableStaffMembers).toHaveBeenCalledWith(' Alex ', { pageSize: 10, activeOrgId: 'org-1', signal, staffOnly: true })
})

it('skips the staff lookup when the staff module is absent', async () => {
  const signal = new AbortController().signal
  expect(await searchPeopleOptions('', { includeCustomers: true, includeStaff: false, signal })).toEqual({
    options: [customer], staffLoadFailed: false, customerLoadFailed: false,
  })
  expect(fetchAssignableStaffMembers).not.toHaveBeenCalled()
})

it('keeps customer results when an enabled staff lookup fails', async () => {
  jest.mocked(fetchAssignableStaffMembers).mockRejectedValueOnce(new Error('Lookup failed'))
  expect(await searchPeopleOptions('', { includeCustomers: true, signal: new AbortController().signal })).toEqual({
    options: [customer], staffLoadFailed: true, customerLoadFailed: false,
  })
})

it('keeps staff results when the user cannot read customer people', async () => {
  jest.mocked(readApiResultOrThrow).mockRejectedValueOnce(new Error('Forbidden'))
  jest.mocked(fetchAssignableStaffMembers).mockResolvedValueOnce([
    { teamMemberId: 'member-id', userId: 'user-id', displayName: 'Alex Chen', email: null, teamName: null },
  ])
  const signal = new AbortController().signal

  expect(await searchPeopleOptions('Alex', { includeCustomers: true, signal })).toEqual({
    options: [{ userId: 'user-id', name: 'Alex Chen', email: null, isCustomer: false }],
    staffLoadFailed: false,
    customerLoadFailed: true,
  })
  expect(readApiResultOrThrow).toHaveBeenCalledWith(expect.stringContaining('/api/customers/people?'), {
    signal, headers: { 'x-om-forbidden-redirect': '0' },
  })
})

it('treats an empty staff roster as a successful lookup', async () => {
  jest.mocked(fetchAssignableStaffMembers).mockResolvedValueOnce([])
  expect(await searchPeopleOptions('', { includeCustomers: false, signal: new AbortController().signal })).toEqual({
    options: [], staffLoadFailed: false, customerLoadFailed: false,
  })
})
