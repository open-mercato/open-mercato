import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from './lib/availabilityAccess'
import { createStaffIdentityResolver } from './lib/identityResolver'
import { createStaffIdentityProjectionResolver } from './lib/identityProjectionResolver'
import { createStaffCandidateResolver } from './lib/candidateResolver'

export type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

export function register(container: AppContainer) {
  const resolver: AvailabilityAccessResolver = { resolveAvailabilityWriteAccess }
  container.register({
    availabilityAccessResolver: asValue(resolver),
    staffIdentityResolver: asFunction(createStaffIdentityResolver).scoped(),
    staffIdentityProjectionResolver: asFunction(createStaffIdentityProjectionResolver).scoped(),
    staffCandidateResolver: asFunction(createStaffCandidateResolver).scoped(),
  })
}
