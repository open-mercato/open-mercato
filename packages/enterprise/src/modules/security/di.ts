import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { PasswordService } from './services/PasswordService'
import { MfaProviderRegistry } from './lib/mfa-provider-registry'
import { TotpProvider } from './lib/providers/TotpProvider'
import { PasskeyProvider } from './lib/providers/PasskeyProvider'
import { OtpEmailProvider } from './lib/providers/OtpEmailProvider'
import { MfaService } from './services/MfaService'
import { MfaVerificationService } from './services/MfaVerificationService'

export function register(container: AppContainer) {
  const mfaProviderRegistry = new MfaProviderRegistry()
  mfaProviderRegistry.register(new TotpProvider())
  mfaProviderRegistry.register(new PasskeyProvider())
  mfaProviderRegistry.register(new OtpEmailProvider())

  container.register({
    mfaProviderRegistry: asValue(mfaProviderRegistry),
    passwordService: asClass(PasswordService).scoped(),
    mfaService: asClass(MfaService).scoped(),
    mfaVerificationService: asClass(MfaVerificationService).scoped(),
  })
}
