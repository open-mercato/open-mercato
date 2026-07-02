import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  Subscription,
  SubscriptionBillingRecord,
  SubscriptionPlan,
  SubscriptionPrice,
} from './data/entities'

export function register(container: AppContainer) {
  container.register({
    SubscriptionPlan: asValue(SubscriptionPlan),
    SubscriptionPrice: asValue(SubscriptionPrice),
    Subscription: asValue(Subscription),
    SubscriptionBillingRecord: asValue(SubscriptionBillingRecord),
  })
}
