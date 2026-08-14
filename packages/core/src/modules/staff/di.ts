import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from './lib/availabilityAccess'
import {
  resolveProjectAccess,
  type ProjectAccess,
  type ProjectAccessContext,
} from './lib/time-tracking/access'

export type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

export type TimeTrackingAccessResolver = {
  resolveProjectAccess(ctx: ProjectAccessContext): Promise<ProjectAccess>
}

export function register(container: AppContainer) {
  const resolver: AvailabilityAccessResolver = { resolveAvailabilityWriteAccess }
  const timeTrackingResolver: TimeTrackingAccessResolver = { resolveProjectAccess }
  container.register({
    availabilityAccessResolver: asValue(resolver),
    timeTrackingAccessResolver: asValue(timeTrackingResolver),
  })
}
