import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { randomBytes } from 'node:crypto'

type EnvReader = (key: string) => string | undefined

const DEFAULT_DERIVED_PASSWORD = 'secret'

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
  const randomEnabled = parseBooleanToken(envRead('OM_INIT_GENERATE_RANDOM_PASSWORD') ?? '') === true
  const randomize = options.randomSource ?? randomBytes
  const randomSecret = () => randomize(9).toString('base64url')
  const resolvePassword = (key: string, emailValue: string | null) => {
    if (!emailValue) return null
    const envValue = envRead(key)
    if (envValue) return envValue
    return randomEnabled ? randomSecret() : DEFAULT_DERIVED_PASSWORD
  }

  return {
    adminEmail,
    employeeEmail,
    adminPassword: resolvePassword('OM_INIT_ADMIN_PASSWORD', adminEmail),
    employeePassword: resolvePassword('OM_INIT_EMPLOYEE_PASSWORD', employeeEmail),
  }
}

