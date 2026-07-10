import type { EntityManager } from '@mikro-orm/postgresql'
import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveAvailabilityWriteAccess,
  type AvailabilityAccessContext,
  type AvailabilityWriteAccess,
} from './lib/availabilityAccess'
import {
  DefaultStaffMemberDirectory,
  type StaffMemberDirectory,
} from './services/staffMemberDirectory'

export type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

export function register(container: AppContainer) {
  const resolver: AvailabilityAccessResolver = { resolveAvailabilityWriteAccess }
  container.register({
    availabilityAccessResolver: asValue(resolver),
    staffMemberDirectory: asFunction<StaffMemberDirectory>(
      (em: EntityManager) => new DefaultStaffMemberDirectory(em),
    ).scoped(),
  })
}
