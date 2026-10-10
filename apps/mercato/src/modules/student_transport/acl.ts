export const features = [
  { id: 'student_transport.read', title: 'View students, subscriptions and runs', module: 'student_transport' },
  { id: 'student_transport.plans.manage', title: 'Manage subscription plans and prices', module: 'student_transport', dependsOn: ['student_transport.read'] },
  { id: 'student_transport.subscriptions.manage', title: 'Manage student subscriptions', module: 'student_transport', dependsOn: ['student_transport.read'] },
  { id: 'student_transport.attendance.record', title: 'Record boarding, drop-off and absences', module: 'student_transport', dependsOn: ['student_transport.read'] },
  { id: 'student_transport.parents.view', title: 'View the parent dashboard', module: 'student_transport', dependsOn: ['student_transport.read'] },
  { id: 'student_transport.admin', title: 'Administer school transport', module: 'student_transport', dependsOn: ['student_transport.subscriptions.manage'] },
]

export default features
