import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdvisoryXactLock, AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import {
  checkRateLimit,
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { ModuleConfigService } from '../../configs/lib/module-config-service'
import { MessageExternalRecipientDay } from '../data/entities'

const USER_RATE_LIMIT_DEFAULTS = {
  points: 20,
  duration: 3600,
  keyPrefix: 'messages_external_user',
} as const
const TENANT_RATE_LIMIT_DEFAULTS = {
  points: 100,
  duration: 3600,
  keyPrefix: 'messages_external_tenant',
} as const
const DAILY_RECIPIENT_CONFIG_KEY = 'externalEmailDailyRecipientLimit'
const DEFAULT_DAILY_RECIPIENT_LIMIT = 100
const NEW_TENANT_DAILY_RECIPIENT_LIMIT = 20
const NEW_TENANT_AGE_MS = 30 * 24 * 60 * 60 * 1000
const dailyRecipientLimitSchema = z.number().int().min(0).max(100000)

type ResolvableContainer = {
  resolve<T>(name: string): T
}

type ExternalEmailBudgetScope = {
  tenantId: string
  userId: string
}

type ExternalEmailBudgetOptions = {
  now?: Date
}

type ExternalEmailBudgetDatabase = {
  message_external_recipient_days: {
    id: string
    tenant_id: string
    utc_day: string
    recipient_hash: string
  }
  tenants: {
    id: string
    created_at: Date | string
  }
}

class ExternalEmailBudgetUnavailableError extends Error {
  constructor() {
    super('[internal] External email budget enforcement is unavailable')
    this.name = 'ExternalEmailBudgetUnavailableError'
  }
}

class DailyExternalRecipientLimitError extends Error {
  constructor() {
    super('[internal] Daily external recipient limit exceeded')
    this.name = 'DailyExternalRecipientLimitError'
  }
}

function resolveRequiredService<T>(container: ResolvableContainer, name: string): T {
  try {
    const service = container.resolve<T>(name)
    if (!service) throw new ExternalEmailBudgetUnavailableError()
    return service
  } catch (error) {
    if (error instanceof ExternalEmailBudgetUnavailableError) throw error
    throw new ExternalEmailBudgetUnavailableError()
  }
}

function utcDayAt(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function secondsUntilNextUtcDay(now: Date): number {
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000))
}

async function resolveDailyRecipientLimit(
  container: ResolvableContainer,
  em: EntityManager,
  tenantId: string,
  now: Date,
): Promise<number> {
  const configService = resolveRequiredService<ModuleConfigService>(container, 'moduleConfigService')
  const configured = await configService.getValue<unknown>('messages', DAILY_RECIPIENT_CONFIG_KEY, {
    scope: { tenantId },
  })
  if (configured !== null && configured !== undefined) {
    return dailyRecipientLimitSchema.parse(configured)
  }

  const tenant = await em.getKysely<ExternalEmailBudgetDatabase>()
    .selectFrom('tenants')
    .select('created_at')
    .where('id', '=', tenantId)
    .executeTakeFirst()
  if (!tenant) throw new ExternalEmailBudgetUnavailableError()
  const createdAt = new Date(tenant.created_at)
  if (!Number.isFinite(createdAt.getTime())) throw new ExternalEmailBudgetUnavailableError()
  return now.getTime() - createdAt.getTime() < NEW_TENANT_AGE_MS
    ? NEW_TENANT_DAILY_RECIPIENT_LIMIT
    : DEFAULT_DAILY_RECIPIENT_LIMIT
}

async function reserveDailyRecipient(
  em: EntityManager,
  input: { tenantId: string; externalEmail: string; limit: number; now: Date },
): Promise<void> {
  const utcDay = utcDayAt(input.now)
  const recipientHash = hashForLookup(input.externalEmail, 'messages.external_recipient')
  await withAdvisoryXactLock(
    em,
    `messages_external_recipient:${input.tenantId}:${utcDay}`,
    async (txEm) => {
      const db = txEm.getKysely<ExternalEmailBudgetDatabase>()
      const existing = await db
        .selectFrom('message_external_recipient_days')
        .select('id')
        .where('tenant_id', '=', input.tenantId)
        .where('utc_day', '=', utcDay)
        .where('recipient_hash', '=', recipientHash)
        .executeTakeFirst()
      if (existing) return

      const countRow = await db
        .selectFrom('message_external_recipient_days')
        .select(sql<string>`count(*)::text`.as('count'))
        .where('tenant_id', '=', input.tenantId)
        .where('utc_day', '=', utcDay)
        .executeTakeFirst()
      const count = Number(countRow?.count ?? 0)
      if (!Number.isSafeInteger(count) || count < 0) throw new ExternalEmailBudgetUnavailableError()
      if (count >= input.limit) throw new DailyExternalRecipientLimitError()

      const reservation = txEm.create(MessageExternalRecipientDay, {
        id: randomUUID(),
        tenantId: input.tenantId,
        utcDay,
        recipientHash,
        createdAt: input.now,
      })
      await txEm.persist(reservation).flush()
    },
    { maxConcurrentHolders: 16 },
  )
}

export async function checkExternalEmailBudget(
  container: ResolvableContainer,
  scope: ExternalEmailBudgetScope,
  externalEmail: string,
  options: ExternalEmailBudgetOptions = {},
): Promise<NextResponse | null> {
  const { t } = await resolveTranslations()
  const unavailableMessage = t('api.errors.rateLimitUnavailable', RATE_LIMIT_UNAVAILABLE_FALLBACK)
  try {
    const rateLimiterService = resolveRequiredService<RateLimiterService>(container, 'rateLimiterService')
    const em = resolveRequiredService<EntityManager>(container, 'em')
    const rateLimitMessage = t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
    const userLimit = await checkRateLimit(
      rateLimiterService,
      readEndpointRateLimitConfig('MESSAGES_EXTERNAL_USER', USER_RATE_LIMIT_DEFAULTS),
      `${scope.tenantId}:${scope.userId}`,
      rateLimitMessage,
      { failClosed: true, unavailableMessage },
    )
    if (userLimit) return userLimit

    const tenantLimit = await checkRateLimit(
      rateLimiterService,
      readEndpointRateLimitConfig('MESSAGES_EXTERNAL_TENANT', TENANT_RATE_LIMIT_DEFAULTS),
      scope.tenantId,
      rateLimitMessage,
      { failClosed: true, unavailableMessage },
    )
    if (tenantLimit) return tenantLimit

    const now = options.now ?? new Date()
    const dailyLimit = await resolveDailyRecipientLimit(container, em, scope.tenantId, now)
    await reserveDailyRecipient(em, {
      tenantId: scope.tenantId,
      externalEmail,
      limit: dailyLimit,
      now,
    })
    return null
  } catch (error) {
    if (error instanceof DailyExternalRecipientLimitError) {
      const retryAfter = secondsUntilNextUtcDay(options.now ?? new Date())
      return NextResponse.json(
        { error: t('messages.errors.externalRecipientDailyLimit', 'Daily external recipient limit reached. Try again tomorrow.') },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Reset': String(retryAfter),
          },
        },
      )
    }
    if (error instanceof ExternalEmailBudgetUnavailableError || error instanceof AdvisoryLockUnavailableError) {
      return NextResponse.json({ error: unavailableMessage }, { status: 503 })
    }
    throw error
  }
}
