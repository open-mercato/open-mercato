import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { randomBytes } from 'node:crypto'

type EnvReader = (key: string) => string | undefined

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveEmailFromDomain(domain: string | undefined, prefix: string): string | null {
  if (!domain) return null
  return `${prefix}@${domain}`
}

export type InitDerivedSecrets = {
  adminEmail: string | null
  employeeEmail: string | null
  adminPassword: string | null
  employeePassword: string | null
}

let warnedAboutDeprecatedRandomToggle = false

export function resolveInitDerivedSecrets(options: {
  email: string
  env?: NodeJS.ProcessEnv
  randomSource?: (size: number) => Buffer
}): InitDerivedSecrets {
  const env = options.env ?? process.env
  const envRead: EnvReader = (key) => readEnvValue(env, key)
  const [, domain] = String(options.email ?? '').split('@')
  const adminEmail = envRead('OM_INIT_ADMIN_EMAIL') ?? resolveEmailFromDomain(domain, 'admin')
  const employeeEmail = envRead('OM_INIT_EMPLOYEE_EMAIL') ?? resolveEmailFromDomain(domain, 'employee')
  // OM_INIT_GENERATE_RANDOM_PASSWORD used to be an opt-in toggle for random
  // derived secrets; that is now the unconditional behaviour when no override
  // is set. Surface a one-time deprecation warning so existing operators
  // notice their config is no longer required.
  if (parseBooleanToken(envRead('OM_INIT_GENERATE_RANDOM_PASSWORD') ?? '') === true && !warnedAboutDeprecatedRandomToggle) {
    warnedAboutDeprecatedRandomToggle = true
    console.warn(
      '⚠️  OM_INIT_GENERATE_RANDOM_PASSWORD is deprecated and no longer required: derived admin/employee passwords are always randomly generated when overrides are unset.',
    )
  }
  const randomize = options.randomSource ?? randomBytes
  const randomSecret = () => randomize(12).toString('base64url')
  const resolvePassword = (key: string, emailValue: string | null) => {
    if (!emailValue) return null
    const envValue = envRead(key)
    if (envValue) return envValue
    return randomSecret()
  }

  return {
    adminEmail,
    employeeEmail,
    adminPassword: resolvePassword('OM_INIT_ADMIN_PASSWORD', adminEmail),
    employeePassword: resolvePassword('OM_INIT_EMPLOYEE_PASSWORD', employeeEmail),
  }
}
