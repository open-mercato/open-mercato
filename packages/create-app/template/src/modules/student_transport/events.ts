import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'student_transport.subscription_plan.created', label: 'Subscription Plan Created', entity: 'subscription_plan', category: 'crud' },
  { id: 'student_transport.subscription_plan.updated', label: 'Subscription Plan Updated', entity: 'subscription_plan', category: 'crud' },
  { id: 'student_transport.subscription_plan.deleted', label: 'Subscription Plan Deleted', entity: 'subscription_plan', category: 'crud' },
  { id: 'student_transport.student_subscription.created', label: 'Student Subscription Created', entity: 'student_subscription', category: 'crud' },
  { id: 'student_transport.student_subscription.updated', label: 'Student Subscription Updated', entity: 'student_subscription', category: 'crud' },
  { id: 'student_transport.student_subscription.deleted', label: 'Student Subscription Deleted', entity: 'student_subscription', category: 'crud' },
  { id: 'student_transport.subscription.activated', label: 'Student Subscription Activated', entity: 'student_subscription', category: 'lifecycle' },
  { id: 'student_transport.subscription.suspended', label: 'Student Subscription Suspended', entity: 'student_subscription', category: 'lifecycle' },
  { id: 'student_transport.subscription.ended', label: 'Student Subscription Ended', entity: 'student_subscription', category: 'lifecycle' },
  { id: 'student_transport.student_trip_attendance.created', label: 'Trip Attendance Recorded', entity: 'student_trip_attendance', category: 'crud' },
  { id: 'student_transport.student_trip_attendance.updated', label: 'Trip Attendance Updated', entity: 'student_trip_attendance', category: 'crud' },
  { id: 'student_transport.student_trip_attendance.deleted', label: 'Trip Attendance Deleted', entity: 'student_trip_attendance', category: 'crud' },
  { id: 'student_transport.attendance.absence_reported', label: 'Absence Reported Before the Trip', entity: 'student_trip_attendance', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'student_transport',
  events,
})

export const emitStudentTransportEvent = eventsConfig.emit
export type StudentTransportEventId = typeof events[number]['id']
export default eventsConfig
