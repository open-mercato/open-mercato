import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createConfiguredRotationProtection, hasCommercialRotationRights } from './lib/rotation-verification/runtime'

export function register(container: AppContainer): void {
  if (!hasCommercialRotationRights()) return
  container.register({ rotationProtectionService: asFunction(() => createConfiguredRotationProtection()).scoped() })
}
