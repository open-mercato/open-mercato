import { isIP } from 'node:net'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { KnownDevice, SignInAttempt, SignInMfaReceipt, SignInNotificationIntent } from '../data/entities'
import type { SignInResult } from '../data/entities'
import { readSignInActivityConfig } from '../lib/sign-in-activity-config'
import { lockSignInAttempt, lockSignInDevice } from '../lib/sign-in-activity-locks'
import { parseUserAgent } from '../lib/user-agent'

export type SignInEvent = {
  tenantId: string
  organizationId: string | null
  userId: string
  attemptId: string
  email: string
  result: SignInResult
  reason: string | null
  ip: string | null
  userAgent: string | null
  occurredAt: Date
}

export class SignInActivityService {
  constructor(private readonly deps: {
    em: EntityManager
    tenantDataEncryptionService: TenantDataEncryptionService
  }) {}

  async recordSignInAttempt(event: SignInEvent): Promise<void> {
    const config = readSignInActivityConfig()
    if (!config.enabled || event.occurredAt.getTime() < Date.now() - config.retentionMs) return

    const { tenantId, organizationId, userId, attemptId, result, occurredAt } = event
    const scope = { tenantId, organizationId }
    const key = { tenantId, sourceAttemptId: attemptId }
    await this.deps.em.transactional(async (em) => {
      if (result === 'success') await lockSignInDevice(em, tenantId, userId)
      await lockSignInAttempt(em, tenantId, attemptId)

      const existing = await findOneWithDecryption(em, SignInAttempt, key, {
        fields: ['id', 'tenantId', 'organizationId', 'userId', 'result'],
      }, scope)
      if (existing) {
        if (existing.userId !== userId || (existing.organizationId ?? null) !== organizationId || existing.result !== result) {
          throw new Error('[internal] Conflicting identity for sign-in event')
        }
        return
      }

      const ipAddress = event.ip && isIP(event.ip) ? event.ip : null
      const userAgent = event.userAgent?.slice(0, 512) || null
      const parsedAgent = parseUserAgent(userAgent)
      const encrypted = await this.deps.tenantDataEncryptionService.encryptEntityPayload(
        'security:sign_in_attempt',
        { email: event.email, emailHash: null, ipAddress, ipHash: null, userAgent },
        tenantId,
        organizationId,
        { em },
      )
      if (
        !isEncryptedPayloadShape(encrypted.email) || !isLookupHash(encrypted.emailHash)
        || (ipAddress && (!isEncryptedPayloadShape(encrypted.ipAddress) || !isLookupHash(encrypted.ipHash)))
        || (userAgent && !isEncryptedPayloadShape(encrypted.userAgent))
      ) {
        throw new Error('[internal] Sign-in activity requires tenant encryption and a keyed lookup hash')
      }

      const deviceKey = [parsedAgent.browserName ?? 'unknown', parsedAgent.osName ?? 'unknown', parsedAgent.deviceType]
        .join('|').toLowerCase()
      const device = result === 'success' ? await this.recordDevice(em, event, deviceKey) : null
      const receipt = result === 'success'
        ? await findOneWithDecryption(em, SignInMfaReceipt, { ...key, userId }, undefined, scope)
        : null
      const isNewDevice = device?.isNew ?? false
      em.persist(em.create(SignInAttempt, {
        ...key,
        organizationId,
        userId,
        email: encrypted.email,
        emailHash: encrypted.emailHash,
        ipAddress: typeof encrypted.ipAddress === 'string' ? encrypted.ipAddress : null,
        ipHash: typeof encrypted.ipHash === 'string' ? encrypted.ipHash : null,
        userAgent: typeof encrypted.userAgent === 'string' ? encrypted.userAgent : null,
        result,
        reason: event.reason,
        browserName: parsedAgent.browserName,
        browserMajor: parsedAgent.browserVersion,
        osName: parsedAgent.osName,
        deviceType: parsedAgent.deviceType,
        deviceKey,
        isNewDevice,
        mfaStatus: result === 'success' ? receipt?.status ?? 'unknown' : null,
        occurredAt,
        createdAt: new Date(),
      }))

      if (device?.isNew && config.notifyNewDevice) {
        em.persist(em.create(SignInNotificationIntent, {
          ...key,
          organizationId,
          userId,
          knownDeviceId: device.id,
          status: 'pending',
          createdAt: new Date(),
        }))
      }
      await em.flush()
    })
  }

  private async recordDevice(em: EntityManager, event: SignInEvent, deviceKey: string) {
    const { tenantId, userId, occurredAt } = event
    const existing = await findOneWithDecryption(em, KnownDevice, {
      tenantId, userId, deviceKey,
    }, undefined, { tenantId })
    if (existing) {
      if (occurredAt > existing.lastSeenAt) existing.lastSeenAt = occurredAt
      return { id: existing.id, isNew: false }
    }

    const hasBaseline = await em.count(KnownDevice, { tenantId, userId }) > 0
    const inserted = await em.execute<{ id: string }[]>(
      `insert into security_known_devices (tenant_id, user_id, device_key, first_seen_at, last_seen_at)
       values (?, ?, ?, ?, ?) on conflict (tenant_id, user_id, device_key) do nothing returning id`,
      [tenantId, userId, deviceKey, occurredAt, occurredAt],
    )
    const device = inserted[0]
    return device ? { id: device.id, isNew: hasBaseline } : null
  }
}

function isLookupHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('v2:')
}
