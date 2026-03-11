import {
  buildMfaProviderComponentHandles,
  createMfaProviderSetup,
} from './lib/mfa-provider-interface'
import type { SecurityModuleConfig } from './lib/security-config'
import { readSecurityModuleConfig, readSecuritySetupTokenSecret } from './lib/security-config'
import { OtpEmailProvider } from './lib/providers/OtpEmailProvider'
import { PasskeyProvider } from './lib/providers/PasskeyProvider'
import { TotpProvider } from './lib/providers/TotpProvider'

export function createDefaultMfaProviders(
  securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
  setupTokenSecret: string = readSecuritySetupTokenSecret(),
) {
  return [
    createMfaProviderSetup(new TotpProvider(securityConfig, setupTokenSecret), buildMfaProviderComponentHandles('totp')),
    createMfaProviderSetup(new PasskeyProvider(securityConfig, setupTokenSecret), buildMfaProviderComponentHandles('passkey')),
    createMfaProviderSetup(new OtpEmailProvider(securityConfig), buildMfaProviderComponentHandles('otp_email')),
  ]
}

export const mfaProviders = createDefaultMfaProviders()

export default mfaProviders
