export type SecurityScope = 'platform' | 'tenant' | 'organization'

export type MfaMethodType = 'totp' | 'passkey' | 'otp_email' | string

export type MfaMethod = {
  id: string
  type: string
  label: string | null
  providerMetadata: Record<string, unknown> | null
  lastUsedAt: string | null
  createdAt: string
}

export type MfaProvider = {
  type: string
  label: string
  icon: string
  allowMultiple: boolean
  components?: {
    setup?: string
    list?: string
    details?: string
    challenge?: string
  }
}

export interface SecurityModuleConfig {
  enableMfa: boolean
  enableSudo: boolean
}
