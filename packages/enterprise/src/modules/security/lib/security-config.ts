import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const DEFAULT_SETUP_TTL_MS = 10 * 60 * 1000
const DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000
const DEFAULT_SUDO_PENDING_CHALLENGE_TTL_MS = 10 * 60 * 1000
const MIN_SUDO_TTL_SECONDS = 30

export type SecurityModuleConfig = {
  totp: {
    issuer: string
    window: number
    digits: number
    periodSeconds: number
    setupTtlMs: number
  }
  otpEmail: {
    expirySeconds: number
    maxAttempts: number
    setupTtlMs: number
    challengeTtlMs: number
    subject: string
  }
  mfa: {
    challengeTtlMs: number
    maxAttempts: number
    emergencyBypass: boolean
  }
  sudo: {
    minTtlSeconds: number
    defaultTtlSeconds: number
    maxTtlSeconds: number
    pendingChallengeTtlMs: number
  }
  webauthn: {
    rpName: string
    rpId: string
    expectedOrigins: string[]
    setupTtlMs: number
    challengeTtlMs: number
  }
  recoveryCodes: {
    count: number
    bcryptCost: number
  }
}

export const defaultSecurityModuleConfig: SecurityModuleConfig = {
  totp: {
    issuer: 'Open Mercato',
    window: 1,
    digits: TOTP_DIGITS,
    periodSeconds: TOTP_PERIOD_SECONDS,
    setupTtlMs: DEFAULT_SETUP_TTL_MS,
  },
  otpEmail: {
    expirySeconds: 600,
    maxAttempts: 5,
    setupTtlMs: DEFAULT_SETUP_TTL_MS,
    challengeTtlMs: 600 * 1000,
    subject: 'Your Open Mercato verification code',
  },
  mfa: {
    challengeTtlMs: 600 * 1000,
    maxAttempts: 5,
    emergencyBypass: false,
  },
  sudo: {
    minTtlSeconds: MIN_SUDO_TTL_SECONDS,
    defaultTtlSeconds: 300,
    maxTtlSeconds: 1800,
    pendingChallengeTtlMs: DEFAULT_SUDO_PENDING_CHALLENGE_TTL_MS,
  },
  webauthn: {
    rpName: 'Open Mercato',
    rpId: 'localhost',
    expectedOrigins: ['http://localhost:3000'],
    setupTtlMs: DEFAULT_SETUP_TTL_MS,
    challengeTtlMs: DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS,
  },
  recoveryCodes: {
    count: 10,
    bcryptCost: 10,
  },
}

export function readSecurityModuleConfig(
  env: NodeJS.ProcessEnv = process.env,
): SecurityModuleConfig {
  const otpExpirySeconds = parsePositiveInteger(env.SECURITY_OTP_EXPIRY_SECONDS)
    ?? defaultSecurityModuleConfig.otpEmail.expirySeconds
  const otpMaxAttempts = parsePositiveInteger(env.SECURITY_OTP_MAX_ATTEMPTS)
    ?? defaultSecurityModuleConfig.otpEmail.maxAttempts
  const sudoMaxTtlSeconds = Math.max(
    parsePositiveInteger(env.SECURITY_SUDO_MAX_TTL) ?? defaultSecurityModuleConfig.sudo.maxTtlSeconds,
    defaultSecurityModuleConfig.sudo.minTtlSeconds,
  )
  const sudoDefaultTtlSeconds = clamp(
    parsePositiveInteger(env.SECURITY_SUDO_DEFAULT_TTL) ?? defaultSecurityModuleConfig.sudo.defaultTtlSeconds,
    defaultSecurityModuleConfig.sudo.minTtlSeconds,
    sudoMaxTtlSeconds,
  )
  const webauthnRpId = readText(env.SECURITY_WEBAUTHN_RP_ID)
    ?? readHostname(env.APP_URL)
    ?? readHostname(env.NEXT_PUBLIC_APP_URL)
    ?? defaultSecurityModuleConfig.webauthn.rpId

  return {
    totp: {
      ...defaultSecurityModuleConfig.totp,
      issuer: readText(env.SECURITY_TOTP_ISSUER) ?? defaultSecurityModuleConfig.totp.issuer,
      window: parseNonNegativeInteger(env.SECURITY_TOTP_WINDOW) ?? defaultSecurityModuleConfig.totp.window,
    },
    otpEmail: {
      ...defaultSecurityModuleConfig.otpEmail,
      expirySeconds: otpExpirySeconds,
      maxAttempts: otpMaxAttempts,
      challengeTtlMs: otpExpirySeconds * 1000,
    },
    mfa: {
      challengeTtlMs: otpExpirySeconds * 1000,
      maxAttempts: otpMaxAttempts,
      emergencyBypass: parseBooleanWithDefault(
        env.SECURITY_MFA_EMERGENCY_BYPASS,
        defaultSecurityModuleConfig.mfa.emergencyBypass,
      ),
    },
    sudo: {
      ...defaultSecurityModuleConfig.sudo,
      defaultTtlSeconds: sudoDefaultTtlSeconds,
      maxTtlSeconds: sudoMaxTtlSeconds,
    },
    webauthn: {
      ...defaultSecurityModuleConfig.webauthn,
      rpName: readText(env.SECURITY_WEBAUTHN_RP_NAME) ?? defaultSecurityModuleConfig.webauthn.rpName,
      rpId: webauthnRpId,
      expectedOrigins: readWebAuthnOrigins(env, webauthnRpId),
    },
    recoveryCodes: {
      ...defaultSecurityModuleConfig.recoveryCodes,
      count: parsePositiveInteger(env.SECURITY_RECOVERY_CODE_COUNT)
        ?? parsePositiveInteger(env.SECURITY_RECOVERY_CODES_COUNT)
        ?? defaultSecurityModuleConfig.recoveryCodes.count,
    },
  }
}

export function readSecuritySetupTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = readText(env.SECURITY_MFA_SETUP_SECRET)
    ?? readText(env.AUTH_JWT_SECRET)
    ?? readText(env.AUTH_SECRET)
    ?? readText(env.JWT_SECRET)

  if (secret) {
    return secret
  }

  throw new Error(
    'Security MFA setup tokens require SECURITY_MFA_SETUP_SECRET, AUTH_JWT_SECRET, AUTH_SECRET, or JWT_SECRET.',
  )
}

function readWebAuthnOrigins(env: NodeJS.ProcessEnv, rpId: string): string[] {
  const fromList = (env.SECURITY_WEBAUTHN_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const singletons = [
    env.SECURITY_WEBAUTHN_ORIGIN,
    env.APP_URL,
    env.NEXT_PUBLIC_APP_URL,
  ]
    .map((value) => readText(value))
    .filter((value): value is string => typeof value === 'string')

  const origins = [...new Set([...fromList, ...singletons])]
  if (origins.length > 0) {
    return origins
  }

  if (rpId === 'localhost') {
    return [...defaultSecurityModuleConfig.webauthn.expectedOrigins]
  }

  return [`https://${rpId}`]
}

function readText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readHostname(value: string | undefined): string | undefined {
  const trimmed = readText(value)
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    return readText(url.hostname)
  } catch {
    return undefined
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.trunc(parsed)
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.trunc(parsed)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
