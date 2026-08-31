import { asClass, asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { PasswordService } from './services/PasswordService'
import { MfaProviderRegistry } from './lib/mfa-provider-registry'
import { isMfaProviderSetup } from './lib/mfa-provider-interface'
import {
  dedupeMfaProviders,
  getSecurityMfaProviderEntries,
} from './lib/module-security-registry'
import { MfaService } from './services/MfaService'
import { MfaVerificationService } from './services/MfaVerificationService'
import { MfaEnforcementService } from './services/MfaEnforcementService'
import { MfaAdminService } from './services/MfaAdminService'
import { SudoChallengeService } from './services/SudoChallengeService'
import { mfaProviders as defaultMfaProviders } from './security.mfa-providers'
import { readSecurityModuleConfig } from './lib/security-config'
import './privacy'

export function register(container: AppContainer) {
  const mfaProviderRegistry = new MfaProviderRegistry()
  const providerEntries = getSecurityMfaProviderEntries()
  const registryProviders = providerEntries.flatMap((entry) => entry.providers ?? [])
  const fallbackProviders = providerEntries.length === 0 ? defaultMfaProviders : []

  for (const provider of dedupeMfaProviders([...registryProviders, ...fallbackProviders])) {
    if (!isMfaProviderSetup(provider)) continue
    mfaProviderRegistry.register(provider)
  }

  container.register({
    mfaProviderRegistry: asValue(mfaProviderRegistry),
    passwordService: asClass(PasswordService).scoped(),
    mfaService: asFunction((cradle: {
      em: EntityManager
      mfaProviderRegistry: MfaProviderRegistry
      tenantEncryptionService: TenantDataEncryptionService
    }) => new MfaService(
      cradle.em,
      cradle.mfaProviderRegistry,
      readSecurityModuleConfig(),
      cradle.tenantEncryptionService,
    )).scoped(),
    mfaVerificationService: asClass(MfaVerificationService).scoped(),
    mfaEnforcementService: asClass(MfaEnforcementService).scoped(),
    mfaAdminService: asClass(MfaAdminService).scoped(),
    sudoChallengeService: asClass(SudoChallengeService).scoped(),
  })
}
