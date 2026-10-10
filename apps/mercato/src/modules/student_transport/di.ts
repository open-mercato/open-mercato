import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { StudentSubscription, StudentSubscriptionSequence, StudentTripAttendance, SubscriptionPlan } from './data/entities'

export function register(container: AppContainer) {
  container.register({
    SubscriptionPlan: asValue(SubscriptionPlan),
    StudentSubscription: asValue(StudentSubscription),
    StudentTripAttendance: asValue(StudentTripAttendance),
    StudentSubscriptionSequence: asValue(StudentSubscriptionSequence),
  })
}
