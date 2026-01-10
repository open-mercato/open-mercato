import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BookingAvailabilityRule } from '../data/entities'
import {
  bookingAvailabilityWeeklyReplaceSchema,
  type BookingAvailabilityWeeklyReplaceInput,
} from '../data/validators'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { ensureOrganizationScope, ensureTenantScope } from './shared'

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

function toDateForWeekday(weekday: number, time: string): Date | null {
  const parsed = parseTimeInput(time)
  if (!parsed) return null
  const now = new Date()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = (weekday - base.getDay() + 7) % 7
  const target = new Date(base.getTime() + diff * 24 * 60 * 60 * 1000)
  target.setHours(parsed.hours, parsed.minutes, 0, 0)
  return target
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildWeeklyRrule(start: Date, end: Date): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  const dayCode = DAY_CODES[start.getDay()] ?? 'MO'
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:FREQ=WEEKLY;BYDAY=${dayCode}`
}

const replaceWeeklyAvailabilityCommand: CommandHandler<BookingAvailabilityWeeklyReplaceInput, { ok: true }> = {
  id: 'booking.availability.weekly.replace',
  async execute(input, ctx) {
    const parsed = bookingAvailabilityWeeklyReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()

    await em.transactional(async (trx) => {
      const existing = await trx.find(BookingAvailabilityRule, {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        subjectType: parsed.subjectType,
        subjectId: parsed.subjectId,
        deletedAt: null,
      })

      const toDelete = existing.filter((rule) => {
        const repeat = parseAvailabilityRuleWindow(rule).repeat
        return repeat === 'weekly' || repeat === 'daily'
      })

      toDelete.forEach((rule) => {
        rule.deletedAt = now
        rule.updatedAt = now
      })

      if (toDelete.length) {
        trx.persist(toDelete)
      }

      parsed.windows.forEach((window) => {
        const start = toDateForWeekday(window.weekday, window.start)
        const end = toDateForWeekday(window.weekday, window.end)
        if (!start || !end || start >= end) return
        const rrule = buildWeeklyRrule(start, end)
        const record = trx.create(BookingAvailabilityRule, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          subjectType: parsed.subjectType,
          subjectId: parsed.subjectId,
          timezone: parsed.timezone,
          rrule,
          exdates: [],
          kind: 'availability',
          note: null,
          createdAt: now,
          updatedAt: now,
        })
        trx.persist(record)
      })

      await trx.flush()
    })

    await invalidateCrudCache(
      ctx.container,
      'booking.availability',
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
      parsed.tenantId,
      'weekly_replace',
    )

    return { ok: true }
  },
}

registerCommand(replaceWeeklyAvailabilityCommand)
