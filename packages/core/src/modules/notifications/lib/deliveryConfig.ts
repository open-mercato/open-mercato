import type { ConfigScope, ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { notificationDeliveryConfigSchema, type NotificationDeliveryConfigInput } from '../data/validators'

export const NOTIFICATIONS_DELIVERY_CONFIG_KEY = 'delivery_strategies'

export type NotificationDeliveryStrategyState = {
  enabled: boolean
}

export type NotificationCustomDeliveryConfig = {
  enabled?: boolean
  config?: unknown
}

export type NotificationEmailDeliveryConfig = NotificationDeliveryStrategyState & {
  from?: string
  replyTo?: string
  subjectPrefix?: string
}

export type NotificationDeliveryConfig = {
  appUrl?: string
  panelPath: string
  strategies: {
    database: NotificationDeliveryStrategyState
    email: NotificationEmailDeliveryConfig
    custom?: Record<string, NotificationCustomDeliveryConfig>
  }
}

const envString = (value: string | undefined | null) => {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

const PLACEHOLDER_EMAIL_DOMAINS = new Set(['your-domain.com'])

const EMAIL_DOMAIN_PATTERN = /@([^@\s<>]+)>?\s*$/

function isPlaceholderEmailAddress(value: string | undefined | null): boolean {
  const address = envString(value)
  if (!address) return false
  const domain = EMAIL_DOMAIN_PATTERN.exec(address)?.[1]?.toLowerCase()
  return domain ? PLACEHOLDER_EMAIL_DOMAINS.has(domain) : false
}

const resolveStoredSenderAddress = (value: string | undefined): string | undefined => {
  const address = envString(value)
  if (!address || isPlaceholderEmailAddress(address)) return undefined
  return address
}

const resolveEnvDefaults = () => {
  const appUrl = envString(
    process.env.NOTIFICATIONS_APP_URL ||
    process.env.APPLICATION_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL
  )
  const panelPath = envString(process.env.NOTIFICATIONS_PANEL_PATH)
  const emailEnabled = parseBooleanWithDefault(process.env.NOTIFICATIONS_EMAIL_ENABLED, true)
  const emailFrom = resolveDefaultEmailFromAddress()
  const emailReplyTo = envString(process.env.NOTIFICATIONS_EMAIL_REPLY_TO || process.env.ADMIN_EMAIL)
  const emailSubjectPrefix = envString(process.env.NOTIFICATIONS_EMAIL_SUBJECT_PREFIX)

  return {
    appUrl,
    panelPath,
    emailEnabled,
    emailFrom,
    emailReplyTo,
    emailSubjectPrefix,
  }
}

export function resolveDefaultNotificationDeliveryConfig(): NotificationDeliveryConfig {
  const env = resolveEnvDefaults()
  return {
    appUrl: env.appUrl,
    panelPath: env.panelPath ?? '/backend/notifications',
    strategies: {
      database: { enabled: true },
      email: {
        enabled: env.emailEnabled,
        from: env.emailFrom,
        replyTo: env.emailReplyTo,
        subjectPrefix: env.emailSubjectPrefix,
      },
      custom: {},
    },
  }
}

export function resolveStoredDefaultNotificationDeliveryConfig(): NotificationDeliveryConfig {
  const defaults = resolveDefaultNotificationDeliveryConfig()
  return {
    ...defaults,
    strategies: {
      ...defaults.strategies,
      email: {
        ...defaults.strategies.email,
        from: undefined,
        replyTo: resolveStoredSenderAddress(defaults.strategies.email.replyTo),
      },
    },
  }
}

export const DEFAULT_NOTIFICATION_DELIVERY_CONFIG: NotificationDeliveryConfig =
  resolveDefaultNotificationDeliveryConfig()

export const STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG: NotificationDeliveryConfig =
  resolveStoredDefaultNotificationDeliveryConfig()

const parseDeliveryConfig = (input: unknown) => {
  const parsed = notificationDeliveryConfigSchema.safeParse(input)
  if (parsed.success || typeof input !== 'object' || input === null) return parsed
  const recoverable = parsed.error.issues.every((issue) => (
    issue.path.length === 1 && issue.path[0] === 'panelPath'
  ) || (
    issue.path.length === 3 && issue.path[0] === 'strategies' && issue.path[1] === 'email'
      && (issue.path[2] === 'from' || issue.path[2] === 'replyTo')
  ) || (
    issue.path.length === 3 && issue.path[0] === 'strategies' && issue.path[1] === 'database' && issue.path[2] === 'enabled'
  ))
  if (!recoverable) return parsed
  const sanitized: Record<string, unknown> = { ...input }
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === 'panelPath') delete sanitized.panelPath
    else if (typeof sanitized.strategies === 'object' && sanitized.strategies !== null) {
      const strategies = { ...sanitized.strategies } as Record<string, unknown>
      if (issue.path[1] === 'database') {
        strategies.database = { enabled: true }
      } else if (typeof strategies.email === 'object' && strategies.email !== null) {
        const email = { ...strategies.email } as Record<string, unknown>
        delete email[String(issue.path[2])]
        strategies.email = email
      }
      sanitized.strategies = strategies
    }
  }
  return notificationDeliveryConfigSchema.safeParse(sanitized)
}

const normalizeDeliveryConfig = (input?: unknown | null): NotificationDeliveryConfig => {
  const parsed = parseDeliveryConfig(input ?? {})
  if (!parsed.success) {
    return { ...DEFAULT_NOTIFICATION_DELIVERY_CONFIG }
  }

  const value = parsed.data ?? {}
  const strategies = value.strategies ?? {}

  return {
    appUrl: value.appUrl,
    panelPath: value.panelPath ?? DEFAULT_NOTIFICATION_DELIVERY_CONFIG.panelPath,
    strategies: {
      database: {
        enabled: DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.database.enabled,
      },
      email: {
        enabled: strategies.email?.enabled ?? DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.enabled,
        from: resolveStoredSenderAddress(strategies.email?.from),
        replyTo: resolveStoredSenderAddress(strategies.email?.replyTo),
        subjectPrefix: strategies.email?.subjectPrefix,
      },
      custom: strategies.custom ?? {},
    },
  }
}

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveNotificationDeliveryConfig(
  resolver: Resolver,
  options?: { defaultValue?: NotificationDeliveryConfig; tenantId?: string | null }
): Promise<NotificationDeliveryConfig> {
  const fallback = options?.defaultValue ?? DEFAULT_NOTIFICATION_DELIVERY_CONFIG
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return { ...fallback }
  }
  try {
    const value = await service.getValue('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, {
      defaultValue: fallback,
      ...(options?.tenantId ? { scope: { tenantId: options.tenantId } } : {}),
    })
    const config = normalizeDeliveryConfig(value)
    if (options?.tenantId) {
      const instanceConfig = await resolveNotificationDeliveryConfig(resolver, { defaultValue: fallback })
      if (!config.appUrl || !isAllowedNotificationAppUrl(config.appUrl, instanceConfig)) {
        config.appUrl = instanceConfig.appUrl
      }
    }
    return config
  } catch {
    return { ...fallback }
  }
}

export async function saveNotificationDeliveryConfig(
  resolver: Resolver,
  config: NotificationDeliveryConfigInput,
  scope?: ConfigScope,
): Promise<void> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('[internal] Configuration service unavailable')
  }

  if (scope?.tenantId) {
    const instanceConfig = await resolveNotificationDeliveryConfig(resolver)
    if (!isAllowedNotificationAppUrl(config.appUrl, instanceConfig)) {
      throw new Error('[internal] Notification appUrl must use the instance origin')
    }
  }
  const normalized = normalizeDeliveryConfig(config)
  await service.setValue('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, normalized, scope)
}

export function resolveNotificationPanelUrl(config: NotificationDeliveryConfig): string | null {
  const base = config.appUrl
    || process.env.APPLICATION_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
  if (!base || !base.trim()) {
    return null
  }
  return `${base.replace(/\/$/, '')}${config.panelPath}`
}

export function isAllowedNotificationAppUrl(
  appUrl: string | undefined,
  instanceConfig: NotificationDeliveryConfig,
): boolean {
  if (appUrl === undefined) return true
  const instanceUrl = resolveNotificationPanelUrl(instanceConfig)
  if (!instanceUrl) return false
  try {
    const candidate = new URL(appUrl)
    const instance = new URL(instanceUrl)
    return (candidate.protocol === 'https:' || candidate.protocol === 'http:')
      && !candidate.username && !candidate.password
      && candidate.origin === instance.origin
  } catch {
    return false
  }
}
