import {
  buildMfaProviderComponentHandles,
  createMfaProviderSetup,
} from './lib/mfa-provider-interface'
import { OtpEmailProvider } from './lib/providers/OtpEmailProvider'
import { PasskeyProvider } from './lib/providers/PasskeyProvider'
import { TotpProvider } from './lib/providers/TotpProvider'

export const mfaProviders = [
  createMfaProviderSetup(new TotpProvider(), buildMfaProviderComponentHandles('totp')),
  createMfaProviderSetup(new PasskeyProvider(), buildMfaProviderComponentHandles('passkey')),
  createMfaProviderSetup(new OtpEmailProvider(), buildMfaProviderComponentHandles('otp_email')),
]

export default mfaProviders
