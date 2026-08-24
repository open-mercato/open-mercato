import { asClass, asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { PrivacyDataClassHandler } from '@open-mercato/shared/lib/privacy'
import { PrivacyPolicyService } from './services/policyService'
import { PrivacyLegalHoldService } from './services/legalHoldService'
import { PrivacyGovernanceService } from './services/governanceService'
import { PrivacyRestoreReapplicationService } from './services/restoreReapplicationService'

export function register(container: AppContainer) {
  container.register({
    privacyPolicyService: asClass(PrivacyPolicyService).scoped(),
    privacyLegalHoldService: asClass(PrivacyLegalHoldService).scoped(),
    privacyGovernanceService: asFunction((
      em: EntityManager,
      privacyPolicyService: PrivacyPolicyService,
      privacyLegalHoldService: PrivacyLegalHoldService,
    ) => new PrivacyGovernanceService({
      em,
      privacyPolicyService,
      privacyLegalHoldService,
      resolveHandler: (key) => container.resolve<PrivacyDataClassHandler>(key),
      resolveManifest: () => container.hasRegistration('erasureManifestService')
        ? container.resolve('erasureManifestService')
        : null,
    })).scoped(),
    privacyRestoreReapplicationService: asFunction((
      privacyGovernanceService: PrivacyGovernanceService,
    ) => new PrivacyRestoreReapplicationService(
      privacyGovernanceService,
      () => container.hasRegistration('erasureManifestService')
        ? container.resolve('erasureManifestService')
        : null,
    )).scoped(),
  })
}
