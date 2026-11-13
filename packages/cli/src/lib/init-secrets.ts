import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getPasswordPolicy, validatePassword } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { randomBytes } from 'node:crypto'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { createRequire } from 'node:module'

const requireLocale = createRequire(import.meta.url)

function initTranslator(env: NodeJS.ProcessEnv) {
  const locale = (env.LC_ALL || env.LC_MESSAGES || env.LANG || 'en').split(/[_.-]/)[0].toLowerCase()
  const supportedLocale = ['en', 'pl', 'es', 'de', 'ko'].includes(locale) ? locale : 'en'
  const dictionary: Record<string, string> = requireLocale(`../i18n/${supportedLocale}.json`)
  return createTranslator(dictionary)
}

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

// Well-known dev/demo password baked into local bootstrap flows so developers
// keep the documented "log in as admin@<domain> with password 'secret'" UX.
// Only used when NODE_ENV !== 'production' and the OM_INIT_*_PASSWORD env vars
// are unset — production paths always use a random 96-bit secret.
const DEMO_DERIVED_PASSWORD = 'secret'

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
  // derived secrets; in production it is now the unconditional behaviour when
  // no override is set. Surface a one-time deprecation warning so existing
  // operators notice their config is no longer required.
  if (parseBooleanToken(envRead('OM_INIT_GENERATE_RANDOM_PASSWORD') ?? '') === true && !warnedAboutDeprecatedRandomToggle) {
    warnedAboutDeprecatedRandomToggle = true
    console.warn(
      '⚠️  OM_INIT_GENERATE_RANDOM_PASSWORD is deprecated and no longer required: derived admin/employee passwords are always randomized in production when overrides are unset.',
    )
  }
  const isProduction = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
  const randomize = options.randomSource ?? randomBytes
  const randomSecret = () => `Aa1!${randomize(Math.max(12, getPasswordPolicy(env).minLength)).toString('base64url')}`
  const resolvePassword = (key: string, emailValue: string | null) => {
    if (!emailValue) return null
    const envValue = envRead(key)
    if (envValue) return envValue
    // Non-production (dev/test/staging defaults): seed the documented demo
    // password so `yarn dev` / `mercato init` workflows stay predictable.
    // Production: generate a fresh random secret so credentials are never
    // hardcoded and the operator-facing CLI prints the value once.
    return isProduction ? randomSecret() : DEMO_DERIVED_PASSWORD
  }

  return {
    adminEmail,
    employeeEmail,
    adminPassword: resolvePassword('OM_INIT_ADMIN_PASSWORD', adminEmail),
    employeePassword: resolvePassword('OM_INIT_EMPLOYEE_PASSWORD', employeeEmail),
  }
}

export function resolveInitSuperadminCredentials(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const argValue = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) || undefined
  const email = argValue('--email') ?? readEnvValue(env, 'OM_INIT_SUPERADMIN_EMAIL') ?? 'superadmin@acme.com'
  const suppliedPassword = argValue('--password') ?? readEnvValue(env, 'OM_INIT_SUPERADMIN_PASSWORD')
  const isProduction = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
  const skipPolicyArg = args.find((arg) =>
    arg === '--skip-password-policy' || arg.startsWith('--skip-password-policy=') ||
    arg === '--allow-weak-password' || arg.startsWith('--allow-weak-password='),
  )
  const skipPasswordPolicy = !isProduction && (skipPolicyArg
    ? parseBooleanToken(skipPolicyArg.split('=')[1] ?? 'true') ?? true
    : true)
  if (isProduction) {
    const t = initTranslator(env)
    const placeholder = suppliedPassword?.trim().toLowerCase()
    if (!suppliedPassword || !placeholder || ['secret', 'password', 'changeme', 'change-me', 'change_me', 'replace-me', 'replace_me'].includes(placeholder)) {
      throw new Error(t('cli.init.errors.superadminPasswordRequired'))
    }
    if (!validatePassword(suppliedPassword, getPasswordPolicy(env)).ok) {
      throw new Error(t('cli.init.errors.superadminPasswordPolicy'))
    }
  }
  return { email, password: suppliedPassword ?? 'secret', skipPasswordPolicy }
}
