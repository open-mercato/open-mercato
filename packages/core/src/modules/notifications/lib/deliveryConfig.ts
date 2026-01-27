import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { notificationDeliveryConfigSchema } from '../data/validators'

export const NOTIFICATIONS_DELIVERY_CONFIG_KEY = 'delivery_strategies'

export type NotificationDeliveryStrategyState = {
  enabled: boolean
}

export type NotificationEmailDeliveryConfig = NotificationDeliveryStrategyState & {
  from?: string
  replyTo?: string
  subjectPrefix?: string
}

export type NotificationSmsDeliveryConfig = NotificationDeliveryStrategyState & {
  webhookUrl?: string
  from?: string
}

export type NotificationDeliveryConfig = {
  appUrl?: string
  panelPath: string
  strategies: {
    database: NotificationDeliveryStrategyState
    email: NotificationEmailDeliveryConfig
    sms: NotificationSmsDeliveryConfig
  }
}

const envString = (value: string | undefined | null) => {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
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
  const smsEnabled = parseBooleanWithDefault(process.env.NOTIFICATIONS_SMS_ENABLED, false)
  const emailFrom = envString(process.env.NOTIFICATIONS_EMAIL_FROM || process.env.EMAIL_FROM)
  const emailReplyTo = envString(process.env.NOTIFICATIONS_EMAIL_REPLY_TO || process.env.ADMIN_EMAIL)
  const emailSubjectPrefix = envString(process.env.NOTIFICATIONS_EMAIL_SUBJECT_PREFIX)
  const smsWebhookUrl = envString(process.env.NOTIFICATIONS_SMS_WEBHOOK_URL)
  const smsFrom = envString(process.env.NOTIFICATIONS_SMS_FROM)

  return {
    appUrl,
    panelPath,
    emailEnabled,
    smsEnabled,
    emailFrom,
    emailReplyTo,
    emailSubjectPrefix,
    smsWebhookUrl,
    smsFrom,
  }
}

export const DEFAULT_NOTIFICATION_DELIVERY_CONFIG: NotificationDeliveryConfig = (() => {
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
      sms: {
        enabled: env.smsEnabled,
        webhookUrl: env.smsWebhookUrl,
        from: env.smsFrom,
      },
    },
  }
})()

const normalizeDeliveryConfig = (input?: unknown | null): NotificationDeliveryConfig => {
  const parsed = notificationDeliveryConfigSchema.safeParse(input ?? {})
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
        from: strategies.email?.from,
        replyTo: strategies.email?.replyTo,
        subjectPrefix: strategies.email?.subjectPrefix,
      },
      sms: {
        enabled: strategies.sms?.enabled ?? DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.sms.enabled,
        webhookUrl: strategies.sms?.webhookUrl,
        from: strategies.sms?.from,
      },
    },
  }
}

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

export async function resolveNotificationDeliveryConfig(
  resolver: Resolver,
  options?: { defaultValue?: NotificationDeliveryConfig }
): Promise<NotificationDeliveryConfig> {
  const fallback = options?.defaultValue ?? DEFAULT_NOTIFICATION_DELIVERY_CONFIG
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    return { ...fallback }
  }
  try {
    const value = await service.getValue('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, { defaultValue: fallback })
    return normalizeDeliveryConfig(value)
  } catch {
    return { ...fallback }
  }
}

export async function saveNotificationDeliveryConfig(
  resolver: Resolver,
  config: NotificationDeliveryConfig
): Promise<void> {
  let service: ModuleConfigService
  try {
    service = resolver.resolve<ModuleConfigService>('moduleConfigService')
  } catch {
    throw new Error('Configuration service unavailable')
  }

  const normalized = normalizeDeliveryConfig(config)
  await service.setValue('notifications', NOTIFICATIONS_DELIVERY_CONFIG_KEY, normalized)
}

export function resolveNotificationPanelUrl(config: NotificationDeliveryConfig): string | null {
  const base = config.appUrl
    || process.env.APPLICATION_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
  if (!base || !base.trim()) {
    return config.panelPath
  }
  return `${base.replace(/\/$/, '')}${config.panelPath}`
}
