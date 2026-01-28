import { z } from 'zod'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

export type PasswordPolicy = {
  minLength: number
  requireDigit: boolean
  requireUppercase: boolean
  requireSpecial: boolean
}

export type PasswordRequirementId = 'minLength' | 'digit' | 'uppercase' | 'special'

export type PasswordRequirement = {
  id: PasswordRequirementId
  value?: number
}

export type PasswordValidationResult = {
  ok: boolean
  violations: PasswordRequirementId[]
}

export type PasswordRequirementFormatter = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 6,
  requireDigit: true,
  requireUppercase: true,
  requireSpecial: true,
}

const ENV_KEYS = {
  minLength: 'OM_PASSWORD_MIN_LENGTH',
  requireDigit: 'OM_PASSWORD_REQUIRE_DIGIT',
  requireUppercase: 'OM_PASSWORD_REQUIRE_UPPERCASE',
  requireSpecial: 'OM_PASSWORD_REQUIRE_SPECIAL',
} as const

const PUBLIC_PREFIX = 'NEXT_PUBLIC_'

function readEnvValue(env: NodeJS.ProcessEnv, key: keyof typeof ENV_KEYS): string | undefined {
  const rawKey = ENV_KEYS[key]
  const publicKey = `${PUBLIC_PREFIX}${rawKey}`
  const rawValue = env[rawKey]
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) return rawValue
  const publicValue = env[publicKey]
  if (typeof publicValue === 'string' && publicValue.trim().length > 0) return publicValue
  return undefined
}

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1): number {
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, parsed)
}

export function getPasswordPolicy(env: NodeJS.ProcessEnv = process.env): PasswordPolicy {
  const minLength = parsePositiveInt(
    readEnvValue(env, 'minLength'),
    DEFAULT_POLICY.minLength,
    1,
  )
  return {
    minLength,
    requireDigit: parseBooleanWithDefault(
      readEnvValue(env, 'requireDigit'),
      DEFAULT_POLICY.requireDigit,
    ),
    requireUppercase: parseBooleanWithDefault(
      readEnvValue(env, 'requireUppercase'),
      DEFAULT_POLICY.requireUppercase,
    ),
    requireSpecial: parseBooleanWithDefault(
      readEnvValue(env, 'requireSpecial'),
      DEFAULT_POLICY.requireSpecial,
    ),
  }
}

export function getPasswordRequirements(policy: PasswordPolicy = getPasswordPolicy()): PasswordRequirement[] {
  const requirements: PasswordRequirement[] = [{ id: 'minLength', value: policy.minLength }]
  if (policy.requireDigit) requirements.push({ id: 'digit' })
  if (policy.requireUppercase) requirements.push({ id: 'uppercase' })
  if (policy.requireSpecial) requirements.push({ id: 'special' })
  return requirements
}

export function formatPasswordRequirements(
  policy: PasswordPolicy,
  translate: PasswordRequirementFormatter,
  keyPrefix = 'auth.password.requirements',
): string {
  const items = getPasswordRequirements(policy).map((requirement) => {
    switch (requirement.id) {
      case 'minLength':
        return translate(
          `${keyPrefix}.minLength`,
          'At least {min} characters',
          { min: requirement.value ?? policy.minLength },
        )
      case 'digit':
        return translate(`${keyPrefix}.digit`, 'One number')
      case 'uppercase':
        return translate(`${keyPrefix}.uppercase`, 'One uppercase letter')
      case 'special':
        return translate(`${keyPrefix}.special`, 'One special character')
      default:
        return ''
    }
  }).filter((value) => value && value.trim().length > 0)

  if (!items.length) return ''
  const separator = translate(`${keyPrefix}.separator`, ', ')
  return items.join(separator)
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = getPasswordPolicy(),
): PasswordValidationResult {
  const violations: PasswordRequirementId[] = []
  if (password.length < policy.minLength) violations.push('minLength')
  if (policy.requireDigit && !/[0-9]/.test(password)) violations.push('digit')
  if (policy.requireUppercase && !/[A-Z]/.test(password)) violations.push('uppercase')
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) violations.push('special')
  return { ok: violations.length === 0, violations }
}

export function buildPasswordSchema(options?: {
  policy?: PasswordPolicy
  maxLength?: number
  message?: string
}): z.ZodType<string> {
  const policy = options?.policy ?? getPasswordPolicy()
  const maxLength = options?.maxLength
  const message = options?.message ?? 'Password does not meet the requirements.'
  let schema = z.string().min(policy.minLength, message)
  if (typeof maxLength === 'number') schema = schema.max(maxLength, message)
  return schema.superRefine((value, ctx) => {
    const result = validatePassword(value, policy)
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message })
    }
  })
}
