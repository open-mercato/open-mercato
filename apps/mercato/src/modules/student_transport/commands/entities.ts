import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StudentSubscription, StudentTripAttendance, SubscriptionPlan } from '../data/entities'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'student_transport',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

export function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

export const STUDENT_PLAN_ENTITY_ID = 'student_transport:subscription_plan' as const
export const STUDENT_SUBSCRIPTION_ENTITY_ID = 'student_transport:student_subscription' as const
export const STUDENT_ATTENDANCE_ENTITY_ID = 'student_transport:student_trip_attendance' as const

export const studentPlanEvents = makeEvents<SubscriptionPlan>('subscription_plan')
export const studentPlanIndexer = makeIndexer<SubscriptionPlan>(STUDENT_PLAN_ENTITY_ID)

export const studentSubscriptionEvents = makeEvents<StudentSubscription>('student_subscription')
export const studentSubscriptionIndexer = makeIndexer<StudentSubscription>(STUDENT_SUBSCRIPTION_ENTITY_ID)

export const studentAttendanceEvents = makeEvents<StudentTripAttendance>('student_trip_attendance')
export const studentAttendanceIndexer = makeIndexer<StudentTripAttendance>(STUDENT_ATTENDANCE_ENTITY_ID)
