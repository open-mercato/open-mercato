export type SecurityScope = 'platform' | 'tenant' | 'organization'

export type MfaMethodType = 'totp' | 'passkey' | 'otp_email' | string

export interface SecurityModuleConfig {
  enableMfa: boolean
  enableSudo: boolean
}
