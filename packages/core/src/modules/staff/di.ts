import type { EntityManager } from '@mikro-orm/postgresql'
import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from './lib/availabilityAccess'
import {
  createStaffTeamMemberResolver,
  type StaffTeamMemberResolver,
} from './lib/teamMemberResolver'

export type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

export type { StaffTeamMemberResolver }

export function register(container: AppContainer) {
  const resolver: AvailabilityAccessResolver = { resolveAvailabilityWriteAccess }
  container.register({
    availabilityAccessResolver: asValue(resolver),
    staffTeamMemberResolver: asFunction(({ em }: { em: EntityManager }) =>
      createStaffTeamMemberResolver(em),
    ).scoped().proxy(),
  })
}
