import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { createLogger } from '@open-mercato/shared/lib/logger'
import NotificationEmail from '../../emails/NotificationEmail'
import type { NotificationDeliveryContext, NotificationDeliveryStrategy } from '../deliveryStrategies'

export const EMAIL_CHANNEL = 'email'

const logger = createLogger('notifications')

const DEBUG = process.env.NOTIFICATIONS_DEBUG === 'true'

function debug(msg: string, fields?: Record<string, unknown>): void {
  if (DEBUG) logger.debug(msg, fields)
}

/**
 * Email delivery as a first-class strategy on the seam (previously hard-coded inline in the dispatch
 * subscriber). Per-user opt-out and `nonOptOut`/`silent` are enforced upstream at create time via
 * `shouldDeliver`; this strategy only owns technical deliverability: it runs when email is enabled by
 * tenant config (`isConfigured`) and there is both a recipient address and a panel deep link.
 */
export const emailDeliveryStrategy: NotificationDeliveryStrategy = {
  id: EMAIL_CHANNEL,
  defaultEnabled: true,
  isConfigured: (ctx: NotificationDeliveryContext) => ctx.deliveryConfig.strategies.email.enabled === true,
  async deliver(ctx: NotificationDeliveryContext) {
    const { recipient, panelLink, title, body, actionLinks, deliveryConfig, t } = ctx
    if (!recipient?.email || !panelLink) {
      debug('email skipped: missing recipient email or panelLink')
      return
    }

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
      logger.error('email delivery failed', { error })
    }
  },
}
