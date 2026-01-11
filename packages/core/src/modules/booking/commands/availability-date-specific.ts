import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/booking/lib/resourceSchedule'
import { BookingAvailabilityRule } from '../data/entities'
import {
  bookingAvailabilityDateSpecificReplaceSchema,
  type BookingAvailabilityDateSpecificReplaceInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import type { BookingAvailabilityKind, BookingAvailabilitySubjectType } from '../data/entities'

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

type DateSpecificUndoPayload = {
  before: AvailabilityRuleSnapshot[]
  after: AvailabilityRuleSnapshot[]
}

function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const [hours, minutes] = value.split(':').map((part) => Number(part))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}

function toDateForDay(value: string, time: string): Date | null {
  if (!value) return null
  const parsed = parseTimeInput(time)
  if (!parsed) return null
  const parts = value.split('-').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  const [year, month, day] = parts
  const date = new Date(year, month - 1, day, parsed.hours, parsed.minutes, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:FREQ=DAILY;COUNT=1`
}

function buildFullDayRrule(date: string): string | null {
  const start = toDateForDay(date, '00:00')
  if (!start) return null
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return buildAvailabilityRrule(start, end)
}

function formatDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

async function loadDateSpecificSnapshots(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    subjectType: BookingAvailabilitySubjectType
    subjectId: string
    dates: Set<string>
  }
): Promise<AvailabilityRuleSnapshot[]> {
  if (!params.dates.size) return []
  const existing = await em.find(BookingAvailabilityRule, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    deletedAt: null,
  })
  return existing
    .filter((rule) => {
      const window = parseAvailabilityRuleWindow(rule)
      if (window.repeat !== 'once') return false
      return params.dates.has(formatDateKey(window.startAt))
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

const replaceDateSpecificAvailabilityCommand: CommandHandler<BookingAvailabilityDateSpecificReplaceInput, { ok: true }> = {
  id: 'booking.availability.date-specific.replace',
  async prepare(input, ctx) {
    const parsed = bookingAvailabilityDateSpecificReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const dates = new Set(parsed.dates.filter((value) => value && value.length))
    const em = (ctx.container.resolve('em') as EntityManager)
    const before = await loadDateSpecificSnapshots(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      dates,
    })
    return { before }
  },
  async execute(input, ctx) {
    const parsed = bookingAvailabilityDateSpecificReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const dates = new Set(parsed.dates.filter((value) => value && value.length))
    const windows = parsed.windows ?? []
    const kind = parsed.kind ?? 'availability'
    const note = parsed.note?.trim() ?? null
    const now = new Date()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.transactional(async (trx) => {
      if (dates.size) {
        const existing = await trx.find(BookingAvailabilityRule, {
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          subjectType: parsed.subjectType,
          subjectId: parsed.subjectId,
          deletedAt: null,
        })
        const toDelete = existing.filter((rule) => {
          const window = parseAvailabilityRuleWindow(rule)
          if (window.repeat !== 'once') return false
          return dates.has(formatDateKey(window.startAt))
        })
        toDelete.forEach((rule) => {
          rule.deletedAt = now
          rule.updatedAt = now
        })
        if (toDelete.length) {
          trx.persist(toDelete)
        }
      }

      if (!dates.size) return

      if (kind === 'unavailability') {
        dates.forEach((date) => {
          const rrule = buildFullDayRrule(date)
          if (!rrule) return
          const record = trx.create(BookingAvailabilityRule, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            subjectType: parsed.subjectType,
            subjectId: parsed.subjectId,
            timezone: parsed.timezone,
            rrule,
            exdates: [],
            kind: 'unavailability',
            note: note && note.length ? note : null,
            createdAt: now,
            updatedAt: now,
          })
          trx.persist(record)
        })
      } else {
        dates.forEach((date) => {
          windows.forEach((window) => {
            const start = toDateForDay(date, window.start)
            const end = toDateForDay(date, window.end)
            if (!start || !end || start >= end) return
            const rrule = buildAvailabilityRrule(start, end)
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
        })
      }

      await trx.flush()
    })
    return { ok: true }
  },
  buildLog: async ({ input, snapshots, ctx }) => {
    const parsed = bookingAvailabilityDateSpecificReplaceSchema.parse(input)
    const dates = new Set(parsed.dates.filter((value) => value && value.length))
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadDateSpecificSnapshots(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      dates,
    })
    const before = (snapshots.before as AvailabilityRuleSnapshot[] | undefined) ?? []
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availability.dateSpecific.replace', 'Replace date-specific availability'),
      resourceKind: 'booking.availability',
      resourceId: null,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before,
          after,
        } satisfies DateSpecificUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<DateSpecificUndoPayload>(logEntry)
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

registerCommand(replaceDateSpecificAvailabilityCommand)
