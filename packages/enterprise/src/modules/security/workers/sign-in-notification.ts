import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildBatchNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { SignInAttempt, SignInNotificationIntent } from '../data/entities'
import { inAppNotificationsAvailable } from '../lib/inAppNotifications'
import { readSignInActivityConfig } from '../lib/sign-in-activity-config'
import { signInNewDeviceNotification } from '../notifications'

export const metadata: WorkerMeta = {
  queue: 'security-sign-in-notification',
  id: 'security:sign-in-notification',
  concurrency: 1,
}

const logger = createLogger('security.sign-in-activity')
const browsers = new Set(['Chrome', 'Firefox', 'Safari', 'Edge', 'Opera', 'Samsung Internet'])
const systems = new Set(['Windows', 'macOS', 'iOS', 'iPadOS', 'Android', 'Linux', 'ChromeOS'])
const utcTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' })
const batchSize = 100

export async function deliverSignInNotification(
  em: EntityManager,
  candidate: { id: string; tenantId: string },
  notificationService: ReturnType<typeof resolveNotificationService> | null,
) {
  await em.transactional(async (transaction) => {
    await transaction.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [
      `security:sign-in:notification:${candidate.tenantId}:${candidate.id}`,
    ])
    const intent = await findOneWithDecryption(transaction, SignInNotificationIntent, {
      id: candidate.id, tenantId: candidate.tenantId, status: 'pending',
    }, { refresh: true }, { tenantId: candidate.tenantId })
    if (!intent) return

    const { tenantId, userId, knownDeviceId, sourceAttemptId } = intent
    const organizationId = intent.organizationId ?? null
    const config = readSignInActivityConfig()
    const scope = { tenantId, organizationId }
    const attempt = await findOneWithDecryption(transaction, SignInAttempt, {
      tenantId, organizationId, sourceAttemptId, userId, result: 'success',
    }, { fields: ['occurredAt', 'browserName', 'osName'] }, scope)

    if (!config.enabled || !config.notifyNewDevice || !attempt || attempt.occurredAt.getTime() < Date.now() - config.retentionMs) {
      intent.status = 'suppressed'
    } else if (notificationService) {
      const browserName = attempt.browserName ?? ''
      const osName = attempt.osName ?? ''
      await notificationService.createBatch({
        ...buildBatchNotificationFromType(signInNewDeviceNotification, {
          recipientUserIds: [userId],
          bodyVariables: {
            browser: browsers.has(browserName) ? browserName : '—',
            os: systems.has(osName) ? osName : '—',
            time: `${utcTime.format(attempt.occurredAt)} UTC`,
          },
          groupKey: `sign_in_new_device:${tenantId}:${userId}:${knownDeviceId}`,
        }),
        channels: ['in_app'],
      }, scope, { skipExistingGroup: true })
      intent.status = 'delivered'
      intent.deliveredAt = new Date()
    }
    await transaction.flush()
  })
}

export default async function handle(_job: QueuedJob) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const service = inAppNotificationsAvailable(container) ? resolveNotificationService(container) : null
  let afterId: string | null = null
  let hadFailure = false
  while (true) {
    const candidates: Pick<SignInNotificationIntent, 'id' | 'tenantId'>[] = await findWithDecryption(em, SignInNotificationIntent, {
      status: 'pending',
      ...(afterId ? { id: { $gt: afterId } } : {}),
    }, { fields: ['id', 'tenantId'], orderBy: { id: 'asc' }, limit: batchSize })
    for (const candidate of candidates) {
      try {
        await deliverSignInNotification(em, candidate, service)
      } catch {
        hadFailure = true
      }
      afterId = candidate.id
    }
    if (candidates.length < batchSize) break
  }
  if (hadFailure) {
    const error = new Error('[internal] Unable to deliver one or more sign-in notifications')
    const code = 'security.sign_in_notification_delivery_failed'
    logger.warn('Sign-in notification delivery will retry', { code })
    getTelemetryRuntime()?.reportError(error, { module: 'security', code })
    throw error
  }
}
