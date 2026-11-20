import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchAssignableStaffMembers } from '../../../detail/assignableStaff'
import { searchPeopleOptions } from '../lookups'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('../../../detail/assignableStaff', () => ({ fetchAssignableStaffMembers: jest.fn() }))

it('uses customer display_name and staff displayName instead of recipient record IDs', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [
    { id: '03790211-3afc-4af8-be5d-5c96abc05ab7', display_name: 'Customer contact', primary_email: 'contact@example.org' },
  ] })
  jest.mocked(fetchAssignableStaffMembers).mockResolvedValue([
    { teamMemberId: 'member-id', userId: 'user-id', displayName: 'Alex Chen', email: null, teamName: null },
  ])
  expect(await searchPeopleOptions('', { includeCustomers: true, signal: new AbortController().signal })).toEqual([
    { userId: 'user-id', name: 'Alex Chen', email: null, isCustomer: false },
    { userId: '03790211-3afc-4af8-be5d-5c96abc05ab7', name: 'Customer contact', email: 'contact@example.org', isCustomer: true },
  ])
})
