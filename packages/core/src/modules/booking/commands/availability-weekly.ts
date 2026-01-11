import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BookingAvailabilityRule } from '../data/entities'
import {
  bookingAvailabilityWeeklyReplaceSchema,
  type BookingAvailabilityWeeklyReplaceInput,
} from '../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { BookingAvailabilityKind, BookingAvailabilitySubjectType } from '../data/entities'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

type AvailabilityRuleSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  subjectType: BookingAvailabilitySubjectType
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  kind: BookingAvailabilityKind
  note: string | null
  deletedAt: Date | null
}

type WeeklyUndoPayload = {
  before: AvailabilityRuleSnapshot[]
  after: AvailabilityRuleSnapshot[]
}

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

function toAvailabilityRuleSnapshot(record: BookingAvailabilityRule): AvailabilityRuleSnapshot {
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    timezone: record.timezone,
    rrule: record.rrule,
    exdates: [...(record.exdates ?? [])],
    kind: record.kind,
    note: record.note ?? null,
    deletedAt: record.deletedAt ?? null,
  }
}

async function loadWeeklySnapshots(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    subjectType: BookingAvailabilitySubjectType
    subjectId: string
  }
): Promise<AvailabilityRuleSnapshot[]> {
  const existing = await em.find(BookingAvailabilityRule, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    deletedAt: null,
  })
  return existing
    .filter((rule) => {
      const repeat = parseAvailabilityRuleWindow(rule).repeat
      return repeat === 'weekly' || repeat === 'daily'
    })
    .map(toAvailabilityRuleSnapshot)
}

async function restoreAvailabilityRuleFromSnapshot(em: EntityManager, snapshot: AvailabilityRuleSnapshot): Promise<void> {
  let record = await em.findOne(BookingAvailabilityRule, { id: snapshot.id })
  if (!record) {
    record = em.create(BookingAvailabilityRule, {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      subjectType: snapshot.subjectType,
      subjectId: snapshot.subjectId,
      timezone: snapshot.timezone,
      rrule: snapshot.rrule,
      exdates: snapshot.exdates ?? [],
      kind: snapshot.kind ?? 'availability',
      note: snapshot.note ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: snapshot.deletedAt ?? null,
    })
    em.persist(record)
  } else {
    record.subjectType = snapshot.subjectType
    record.subjectId = snapshot.subjectId
    record.timezone = snapshot.timezone
    record.rrule = snapshot.rrule
    record.exdates = snapshot.exdates ?? []
    record.kind = snapshot.kind ?? 'availability'
    record.note = snapshot.note ?? null
    record.deletedAt = snapshot.deletedAt ?? null
  }
}

const replaceWeeklyAvailabilityCommand: CommandHandler<BookingAvailabilityWeeklyReplaceInput, { ok: true }> = {
  id: 'booking.availability.weekly.replace',
  async prepare(input, ctx) {
    const parsed = bookingAvailabilityWeeklyReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager)
    const before = await loadWeeklySnapshots(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
    })
    return { before }
  },
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

    return { ok: true }
  },
  buildLog: async ({ input, snapshots, ctx }) => {
    const parsed = bookingAvailabilityWeeklyReplaceSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadWeeklySnapshots(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
    })
    const before = (snapshots.before as AvailabilityRuleSnapshot[] | undefined) ?? []
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availability.weekly.replace', 'Replace weekly availability'),
      resourceKind: 'booking.availability',
      resourceId: null,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: {
          before,
          after,
        } satisfies WeeklyUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<WeeklyUndoPayload>(logEntry)
    const before = payload?.before ?? []
    const after = payload?.after ?? []
    if (!before.length && !after.length) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.transactional(async (trx) => {
      if (after.length) {
        const ids = after.map((rule) => rule.id)
        const records = await trx.find(BookingAvailabilityRule, { id: { $in: ids } })
        records.forEach((record) => {
          record.deletedAt = new Date()
        })
        if (records.length) trx.persist(records)
      }

      for (const snapshot of before) {
        await restoreAvailabilityRuleFromSnapshot(trx, { ...snapshot, deletedAt: null })
      }

      await trx.flush()
    })
  },
}

registerCommand(replaceWeeklyAvailabilityCommand)
