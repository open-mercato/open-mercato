import type { EntityManager } from '@mikro-orm/postgresql'
import { Notification } from '../data/entities'
import { NOTIFICATION_EVENTS } from '../lib/events'
import { DEFAULT_NOTIFICATION_DELIVERY_CONFIG, resolveNotificationDeliveryConfig, resolveNotificationPanelUrl } from '../lib/deliveryConfig'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import NotificationEmail from '../emails/NotificationEmail'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../auth/data/entities'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

export const metadata = {
  event: NOTIFICATION_EVENTS.CREATED,
  persistent: true,
  id: 'notifications:deliver',
}

const DEBUG = process.env.NOTIFICATIONS_DEBUG === 'true'

function debug(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[notifications]', ...args)
  }
}

type NotificationCreatedPayload = {
  notificationId: string
  recipientUserId: string
  tenantId: string
  organizationId?: string | null
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const buildPanelLink = (panelUrl: string, notificationId: string) => {
  if (panelUrl.startsWith('http://') || panelUrl.startsWith('https://')) {
    const url = new URL(panelUrl)
    url.searchParams.set('notificationId', notificationId)
    return url.toString()
  }
  const separator = panelUrl.includes('?') ? '&' : '?'
  return `${panelUrl}${separator}notificationId=${encodeURIComponent(notificationId)}`
}

const resolveNotificationCopy = async (
  notification: Notification
) => {
  const dict = await loadDictionary(defaultLocale)
  const t = createFallbackTranslator(dict)

  const title = notification.titleKey
    ? t(notification.titleKey, notification.title ?? notification.titleKey, notification.titleVariables ?? undefined)
    : notification.title

  const body = notification.bodyKey
    ? t(notification.bodyKey, notification.body ?? notification.bodyKey ?? '', notification.bodyVariables ?? undefined)
    : notification.body ?? null

  return { title, body, t }
}

const resolveRecipient = async (
  em: EntityManager,
  notification: Notification,
  encryptionService?: TenantDataEncryptionService | null,
) => {
  const where: Partial<User> & { deletedAt?: null } = {
    id: notification.recipientUserId,
    tenantId: notification.tenantId,
    deletedAt: null,
  }
  if (notification.organizationId) {
    where.organizationId = notification.organizationId
  }
  const record = await findOneWithDecryption(
    em,
    User,
    where,
    undefined,
    {
      tenantId: notification.tenantId,
      organizationId: notification.organizationId ?? null,
      encryptionService: encryptionService ?? null,
    },
  )
  if (!record) return null
  return {
    email: typeof record.email === 'string' ? record.email : null,
    name: typeof record.name === 'string' ? record.name : null,
  }
}


export default async function handle(payload: NotificationCreatedPayload, ctx: ResolverContext) {
  debug('deliver notification event', payload)
  const deliveryConfig = await resolveNotificationDeliveryConfig(ctx, { defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG })
  if (!deliveryConfig.strategies.email.enabled) {
    debug('email delivery disabled')
    return
  }

  const em = ctx.resolve('em') as EntityManager
  const notification = await em.findOne(Notification, {
    id: payload.notificationId,
    tenantId: payload.tenantId,
    organizationId: payload.organizationId ?? null,
  })
  if (!notification) {
    debug('notification not found', payload.notificationId)
    return
  }

  let encryptionService: TenantDataEncryptionService | null = null
  try {
    encryptionService = ctx.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  } catch {
    encryptionService = null
  }

  const recipient = await resolveRecipient(em, notification, encryptionService)
  if (!recipient?.email) {
    debug('recipient has no email', notification.recipientUserId)
  }
  const { title, body, t } = await resolveNotificationCopy(notification)
  const panelUrl = resolveNotificationPanelUrl(deliveryConfig)
  if (!panelUrl) {
    debug('missing panelUrl; check appUrl/panelPath settings')
    return
  }

  const panelLink = buildPanelLink(panelUrl, notification.id)
  const actionLinks = (notification.actionData?.actions ?? []).map((action) => ({
    id: action.id,
    label: action.labelKey ? t(action.labelKey, action.label) : action.label,
    href: panelLink,
  }))

  if (deliveryConfig.strategies.email.enabled && recipient?.email) {
    const subjectPrefix = deliveryConfig.strategies.email.subjectPrefix?.trim()
    const subject = subjectPrefix ? `${subjectPrefix} ${title}` : title
    const copy = {
      preview: t('notifications.delivery.email.preview', 'New notification'),
      heading: t('notifications.delivery.email.heading', 'You have a new notification'),
      bodyIntro: t('notifications.delivery.email.bodyIntro', 'Review the notification details and take any required actions.'),
      actionNotice: t('notifications.delivery.email.actionNotice', 'Actions are available in Open Mercato and are read-only in this email.'),
      openCta: t('notifications.delivery.email.openCta', 'Open notification center'),
      footer: t('notifications.delivery.email.footer', 'Open Mercato notifications'),
    }

    try {
      debug('sending email', { to: recipient.email, from: deliveryConfig.strategies.email.from, subject })
      await sendEmail({
        to: recipient.email,
        subject,
        from: deliveryConfig.strategies.email.from,
        replyTo: deliveryConfig.strategies.email.replyTo,
        react: NotificationEmail({
          title,
          body,
          actions: actionLinks,
          panelUrl: panelLink,
          copy,
        }),
      })
    } catch (error) {
      console.error('[notifications] email delivery failed', error)
    }
  }

  return
}
