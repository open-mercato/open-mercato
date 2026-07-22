export const features = [
  { id: 'staff.view', title: 'View employees', module: 'staff' },
  { id: 'staff.manage_team', title: 'Manage employees', module: 'staff' },
  { id: 'staff.leave_requests.send', title: 'Send leave requests', module: 'staff' },
  { id: 'staff.leave_requests.manage', title: 'Manage leave requests', module: 'staff' },
  { id: 'staff.my_availability.view', title: 'View my availability', module: 'staff' },
  { id: 'staff.my_availability.manage', title: 'Manage my availability', module: 'staff' },
  { id: 'staff.my_availability.unavailability', title: 'Manage my unavailability', module: 'staff' },
  { id: 'staff.my_leave_requests.view', title: 'View my leave requests', module: 'staff' },
  { id: 'staff.my_leave_requests.send', title: 'Send my leave requests', module: 'staff' },

  // Timesheets (Phase 1)
  { id: 'staff.timesheets.view', title: 'View own time entries', module: 'staff' },
  { id: 'staff.timesheets.manage_own', title: 'Create/edit/delete own entries', module: 'staff' },
  { id: 'staff.timesheets.manage_all', title: 'Manage all employees entries', module: 'staff' },
  { id: 'staff.timesheets.projects.view', title: 'View time projects', module: 'staff' },
  { id: 'staff.timesheets.projects.manage', title: 'Manage time projects', module: 'staff' },

  // Timesheets (Phase 2)
  { id: 'staff.timesheets.approve', title: 'Approve reportee time', module: 'staff' },
  { id: 'staff.timesheets.lock', title: 'Lock time periods', module: 'staff' },
]

export default features
