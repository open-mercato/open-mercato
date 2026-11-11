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
  RATE_LIMIT_ERROR_FALLBACK,
  RATE_LIMIT_ERROR_KEY,
  RATE_LIMIT_UNAVAILABLE_FALLBACK,
} from '@open-mercato/shared/lib/ratelimit/helpers'
import type { ModuleConfigService } from '../../configs/lib/module-config-service'
import { MessageExternalEmailWindow, MessageExternalRecipientDay } from '../data/entities'

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
  message_external_email_windows: {
    id: string
    scope: 'user' | 'tenant'
    tenant_id: string
    subject_id: string
    window_start: number
    count: number
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

class FixedWindowLimitError extends Error {
  constructor(
    readonly points: number,
    readonly retryAfter: number,
  ) {
    super('[internal] External email rate limit exceeded')
    this.name = 'FixedWindowLimitError'
  }
}

export class ExternalEmailBudgetError extends Error {
  constructor(readonly response: NextResponse) {
    super('[internal] External email budget rejected')
    this.name = 'ExternalEmailBudgetError'
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

async function reserveFixedWindow(
  txEm: EntityManager,
  input: {
    scope: 'user' | 'tenant'
    tenantId: string
    subjectId: string
    points: number
    duration: number
    now: Date
  },
): Promise<void> {
  const nowSeconds = Math.floor(input.now.getTime() / 1000)
  const windowStart = Math.floor(nowSeconds / input.duration) * input.duration
  const db = txEm.getKysely<ExternalEmailBudgetDatabase>()
  const existing = await db
    .selectFrom('message_external_email_windows')
    .select(['id', 'count'])
    .where('scope', '=', input.scope)
    .where('tenant_id', '=', input.tenantId)
    .where('subject_id', '=', input.subjectId)
    .where('window_start', '=', windowStart)
    .executeTakeFirst()
  const retryAfter = Math.max(1, windowStart + input.duration - nowSeconds)
  if (existing && existing.count >= input.points) {
    throw new FixedWindowLimitError(input.points, retryAfter)
  }
  if (!existing && input.points <= 0) {
    throw new FixedWindowLimitError(input.points, retryAfter)
  }

  if (existing) {
    await db
      .updateTable('message_external_email_windows')
      .set({ count: existing.count + 1 })
      .where('id', '=', existing.id)
      .execute()
    return
  }

  const window = txEm.create(MessageExternalEmailWindow, {
    id: randomUUID(),
    scope: input.scope,
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    windowStart,
    count: 1,
    createdAt: input.now,
    updatedAt: input.now,
  })
  await txEm.persist(window).flush()
}

async function reserveDailyRecipient(
  txEm: EntityManager,
  input: { tenantId: string; externalEmail: string; limit: number; now: Date },
): Promise<void> {
  const utcDay = utcDayAt(input.now)
  const recipientHash = hashForLookup(input.externalEmail, 'messages.external_recipient')
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
    const em = resolveRequiredService<EntityManager>(container, 'em')
    const now = options.now ?? new Date()
    const userConfig = readEndpointRateLimitConfig('MESSAGES_EXTERNAL_USER', USER_RATE_LIMIT_DEFAULTS)
    const tenantConfig = readEndpointRateLimitConfig('MESSAGES_EXTERNAL_TENANT', TENANT_RATE_LIMIT_DEFAULTS)
    const dailyLimit = await resolveDailyRecipientLimit(container, em, scope.tenantId, now)
    await withAdvisoryXactLock(
      em,
      `messages_external_email:${scope.tenantId}`,
      async (txEm) => {
        await reserveFixedWindow(txEm, {
          scope: 'user',
          tenantId: scope.tenantId,
          subjectId: scope.userId,
          points: userConfig.points,
          duration: userConfig.duration,
          now,
        })
        await reserveFixedWindow(txEm, {
          scope: 'tenant',
          tenantId: scope.tenantId,
          subjectId: scope.tenantId,
          points: tenantConfig.points,
          duration: tenantConfig.duration,
          now,
        })
        await reserveDailyRecipient(txEm, {
          tenantId: scope.tenantId,
          externalEmail,
          limit: dailyLimit,
          now,
        })
      },
      { maxConcurrentHolders: 16 },
    )
    return null
  } catch (error) {
    if (error instanceof FixedWindowLimitError) {
      return NextResponse.json(
        { error: t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK) },
        {
          status: 429,
          headers: {
            'Retry-After': String(error.retryAfter),
            'X-RateLimit-Limit': String(error.points),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(error.retryAfter),
          },
        },
      )
    }
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

export async function assertExternalEmailBudget(
  container: ResolvableContainer,
  scope: ExternalEmailBudgetScope,
  externalEmail: string,
): Promise<void> {
  const response = await checkExternalEmailBudget(container, scope, externalEmail)
  if (response) throw new ExternalEmailBudgetError(response)
}

export function getExternalEmailBudgetErrorResponse(error: unknown): NextResponse | null {
  return error instanceof ExternalEmailBudgetError ? error.response : null
}
