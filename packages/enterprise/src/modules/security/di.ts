import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
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
import { SignInActivityService } from './services/SignInActivityService'
import { SudoChallengeService } from './services/SudoChallengeService'
import { mfaProviders as defaultMfaProviders } from './security.mfa-providers'

export function register(container: AppContainer) {

  container.register({
    mfaProviderRegistry: asScopedService(() => {
  const mfaProviderRegistry = new MfaProviderRegistry()
  const providerEntries = getSecurityMfaProviderEntries()
  const registryProviders = providerEntries.flatMap((entry) => entry.providers ?? [])
  const fallbackProviders = providerEntries.length === 0 ? defaultMfaProviders : []

  for (const provider of dedupeMfaProviders([...registryProviders, ...fallbackProviders])) {
    if (!isMfaProviderSetup(provider)) continue
    mfaProviderRegistry.register(provider)
  }

    return mfaProviderRegistry
    }),
    passwordService: asClass(PasswordService).scoped(),
    mfaService: asClass(MfaService).scoped(),
    mfaVerificationService: asClass(MfaVerificationService).scoped(),
    mfaEnforcementService: asClass(MfaEnforcementService).scoped(),
    mfaAdminService: asClass(MfaAdminService).scoped(),
    signInActivityService: asClass(SignInActivityService).scoped(),
    sudoChallengeService: asClass(SudoChallengeService).scoped(),
  })
}

defineProcessDiRegistrar(register)
