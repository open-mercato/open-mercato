/**
 * @deprecated Import from `@open-mercato/core/modules/customers/lib/assignableStaff` instead.
 * This path is a compatibility bridge kept for one minor version after 0.6.7; it will be
 * removed in 0.7.0. The implementation moved to `../../lib/assignableStaff` so non-component
 * callers (API routes, commands) can use it without importing from a `components/` path.
 */
export {
  fetchAssignableStaffMembersPage,
  fetchAssignableStaffMembers,
  mapAssignableStaffToFilterOptions,
  ensureCurrentUserFilterOption,
  type AssignableStaffMember,
  type AssignableStaffMembersPage,
} from '../../lib/assignableStaff'
