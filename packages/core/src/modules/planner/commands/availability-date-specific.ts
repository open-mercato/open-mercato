import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/planner/lib/availabilitySchedule'
import { PlannerAvailabilityRule } from '../data/entities'
import {
  plannerAvailabilityDateSpecificReplaceSchema,
  type PlannerAvailabilityDateSpecificReplaceInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import type { PlannerAvailabilityKind, PlannerAvailabilitySubjectType } from '../data/entities'

type AvailabilityRuleSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  subjectType: PlannerAvailabilitySubjectType
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  kind: PlannerAvailabilityKind
  note: string | null
  unavailabilityReasonEntryId: string | null
  unavailabilityReasonValue: string | null
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

function toAvailabilityRuleSnapshot(record: PlannerAvailabilityRule): AvailabilityRuleSnapshot {
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
    unavailabilityReasonEntryId: record.unavailabilityReasonEntryId ?? null,
    unavailabilityReasonValue: record.unavailabilityReasonValue ?? null,
    deletedAt: record.deletedAt ?? null,
  }
}

async function loadDateSpecificSnapshots(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    subjectType: PlannerAvailabilitySubjectType
    subjectId: string
    dates: Set<string>
  }
): Promise<AvailabilityRuleSnapshot[]> {
  if (!params.dates.size) return []
  const existing = await em.find(PlannerAvailabilityRule, {
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
  let record = await em.findOne(PlannerAvailabilityRule, { id: snapshot.id })
  if (!record) {
    record = em.create(PlannerAvailabilityRule, {
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
      unavailabilityReasonEntryId: snapshot.unavailabilityReasonEntryId ?? null,
      unavailabilityReasonValue: snapshot.unavailabilityReasonValue ?? null,
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
    record.unavailabilityReasonEntryId = snapshot.unavailabilityReasonEntryId ?? null
    record.unavailabilityReasonValue = snapshot.unavailabilityReasonValue ?? null
    record.deletedAt = snapshot.deletedAt ?? null
  }
}

const replaceDateSpecificAvailabilityCommand: CommandHandler<PlannerAvailabilityDateSpecificReplaceInput, { ok: true }> = {
  id: 'planner.availability.date-specific.replace',
  async prepare(input, ctx) {
    const parsed = plannerAvailabilityDateSpecificReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const dates = resolveDateSet(parsed)
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
    const parsed = plannerAvailabilityDateSpecificReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const dates = resolveDateSet(parsed)
    const windows = parsed.windows ?? []
    const kind = parsed.kind ?? (parsed.isAvailable === false ? 'unavailability' : 'availability')
    const isAvailable = kind !== 'unavailability'
    const note = typeof parsed.note === 'string' && parsed.note.trim().length ? parsed.note.trim() : null
    const unavailabilityReasonEntryId = isAvailable ? null : parsed.unavailabilityReasonEntryId ?? null
    const unavailabilityReasonValue = isAvailable ? null : parsed.unavailabilityReasonValue ?? null
    const now = new Date()

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.transactional(async (trx) => {
      if (dates.size) {
        const existing = await trx.find(PlannerAvailabilityRule, {
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

      if (!isAvailable) {
        dates.forEach((date) => {
          const rrule = buildFullDayRrule(date)
          if (!rrule) return
          const record = trx.create(PlannerAvailabilityRule, {
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
            subjectType: parsed.subjectType,
            subjectId: parsed.subjectId,
            timezone: parsed.timezone,
            rrule,
            exdates: [],
            kind: 'unavailability',
            note,
            unavailabilityReasonEntryId,
            unavailabilityReasonValue,
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
            const record = trx.create(PlannerAvailabilityRule, {
              tenantId: parsed.tenantId,
              organizationId: parsed.organizationId,
              subjectType: parsed.subjectType,
              subjectId: parsed.subjectId,
              timezone: parsed.timezone,
              rrule,
              exdates: [],
              kind: 'availability',
              note: null,
              unavailabilityReasonEntryId: null,
              unavailabilityReasonValue: null,
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
    const parsed = plannerAvailabilityDateSpecificReplaceSchema.parse(input)
    const dates = resolveDateSet(parsed)
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
      actionLabel: translate('planner.audit.availability.dateSpecific.replace', 'Replace date-specific availability'),
      resourceKind: 'planner.availability',
      resourceId: null,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
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
        const records = await trx.find(PlannerAvailabilityRule, { id: { $in: ids } })
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

function resolveDateSet(input: PlannerAvailabilityDateSpecificReplaceInput): Set<string> {
  const dates = Array.isArray(input.dates) ? input.dates.filter((value) => typeof value === 'string' && value.length > 0) : []
  if (dates.length) return new Set(dates)
  if (typeof input.date === 'string' && input.date.length > 0) return new Set([input.date])
  return new Set()
}

registerCommand(replaceDateSpecificAvailabilityCommand)
