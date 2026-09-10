import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseAvailabilityRuleWindow } from '@open-mercato/core/modules/planner/lib/availabilitySchedule'
import { nextWeekdayDateKey, zonedWallTimeToInstant, zonedWeekday } from '@open-mercato/core/modules/planner/lib/availabilityTimezone'
import { PlannerAvailabilityRule, PlannerAvailabilityRuleSet } from '../data/entities'
import {
  plannerAvailabilityWeeklyReplaceSchema,
  type PlannerAvailabilityWeeklyReplaceInput,
} from '../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import {
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { PlannerAvailabilityKind, PlannerAvailabilitySubjectType } from '../data/entities'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { plannerAvailabilityRuleSetCrudEvents } from '../lib/crud'
import { E } from '#generated/entities.ids.generated'

const AVAILABILITY_RULE_RESOURCE_KIND = 'planner.availability.rule'
const AVAILABILITY_RULE_SET_CACHE_RESOURCE_KIND = 'planner.availability-rule-set'

const availabilityRuleSetCrudIndexer: CrudIndexerConfig<PlannerAvailabilityRuleSet> = {
  entityType: E.planner.planner_availability_rule_set,
}

// Canonical resource kind for the parent rule set, matching the tag the CRUD
// factory derives for `planner.availability-rule-sets.*` commands. Weekly
// replace mutates the rule set's child `availability_rules`, so the parent is
// the optimistic-lock consistency boundary (document-aggregate pattern).
const AVAILABILITY_RULE_SET_RESOURCE_KIND = 'planner.availability.rule.set'

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

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
  deletedAt: Date | null
}

type WeeklyUndoPayload = {
  before: AvailabilityRuleSnapshot[]
  after: AvailabilityRuleSnapshot[]
}

/**
 * `from` is threaded in rather than defaulted per call: resolving a window's
 * start and end against two separate `new Date()` reads can straddle midnight
 * in the declared zone, which lands the anchors seven days apart and silently
 * drops the window at the `start >= end` guard below.
 */
function toDateForWeekday(weekday: number, time: string, timeZone: string, from: Date): Date | null {
  return zonedWallTimeToInstant(nextWeekdayDateKey(weekday, timeZone, from), time, timeZone)
}

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildWeeklyRrule(start: Date, end: Date, timeZone: string): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  // `BYDAY` names the weekday the window falls on in its DECLARED zone, which
  // is the meaningful label for a recurring local-time window. It is therefore
  // deliberately not consistent with the `Z`-suffixed `DTSTART` beside it: a
  // Pacific/Auckland Monday 09:00 ships DTSTART:...T210000Z, a Sunday in UTC,
  // with BYDAY=MO. Nothing in the planner reads BYDAY today (neither the
  // expander nor `parseAvailabilityRuleWindow`); a future iCal export must
  // re-derive it from the zone rather than trust it against DTSTART.
  const dayCode = DAY_CODES[zonedWeekday(start, timeZone)] ?? 'MO'
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:FREQ=WEEKLY;BYDAY=${dayCode}`
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
    deletedAt: record.deletedAt ?? null,
  }
}

function nextRuleSetUpdatedAt(current: Date | null | undefined, fallback: Date): Date {
  const currentMs = current instanceof Date ? current.getTime() : Number.NaN
  if (Number.isFinite(currentMs) && fallback.getTime() <= currentMs) {
    return new Date(currentMs + 1)
  }
  return fallback
}

async function loadWeeklySnapshots(
  em: EntityManager,
  params: {
    tenantId: string
    organizationId: string
    subjectType: PlannerAvailabilitySubjectType
    subjectId: string
  }
): Promise<AvailabilityRuleSnapshot[]> {
  const existing = await em.find(PlannerAvailabilityRule, {
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

const replaceWeeklyAvailabilityCommand: CommandHandler<PlannerAvailabilityWeeklyReplaceInput, { ok: true }> = {
  id: 'planner.availability.weekly.replace',
  async prepare(input, ctx) {
    const parsed = plannerAvailabilityWeeklyReplaceSchema.parse(input)
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
    const parsed = plannerAvailabilityWeeklyReplaceSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()

    // The weekly rules of a rule set are a sub-resource of that rule set: the
    // parent is the optimistic-lock consistency boundary. Guard the parent's
    // version (so a stale weekly save loses to a concurrent rule-set
    // change/delete) and bump its `updated_at` after the replace (so a
    // concurrent rule-set delete/update with a stale token conflicts). See #2927.
    const touchedRuleSet = await em.transactional(async (trx): Promise<PlannerAvailabilityRuleSet | null> => {
      let ruleSet: PlannerAvailabilityRuleSet | null = null
      if (parsed.subjectType === 'ruleset') {
        ruleSet = await trx.findOne(PlannerAvailabilityRuleSet, {
          id: parsed.subjectId,
          tenantId: parsed.tenantId,
          organizationId: parsed.organizationId,
          deletedAt: null,
        })
        if (ruleSet) {
          enforceCommandOptimisticLock({
            resourceKind: AVAILABILITY_RULE_SET_RESOURCE_KIND,
            resourceId: ruleSet.id,
            current: ruleSet.updatedAt,
            request: ctx.request ?? null,
          })
        } else {
          // The rule set was deleted concurrently. When the client opted into
          // optimistic locking, surface the unified conflict instead of
          // silently writing orphan rules; otherwise preserve legacy behavior.
          enforceRecordGoneIsConflict({
            resourceKind: AVAILABILITY_RULE_SET_RESOURCE_KIND,
            resourceId: parsed.subjectId,
            request: ctx.request ?? null,
          })
        }
      }

      const existing = await trx.find(PlannerAvailabilityRule, {
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
        const start = toDateForWeekday(window.weekday, window.start, parsed.timezone, now)
        const end = toDateForWeekday(window.weekday, window.end, parsed.timezone, now)
        if (!start || !end || start >= end) return
        const rrule = buildWeeklyRrule(start, end, parsed.timezone)
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
          createdAt: now,
          updatedAt: now,
        })
        trx.persist(record)
      })

      if (ruleSet) {
        ruleSet.updatedAt = nextRuleSetUpdatedAt(ruleSet.updatedAt, now)
        trx.persist(ruleSet)
      }

      await trx.flush()
      return ruleSet
    })

    if (touchedRuleSet) {
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: touchedRuleSet,
        identifiers: {
          id: touchedRuleSet.id,
          organizationId: touchedRuleSet.organizationId,
          tenantId: touchedRuleSet.tenantId,
        },
        events: plannerAvailabilityRuleSetCrudEvents,
        indexer: availabilityRuleSetCrudIndexer,
      })
    }

    return { ok: true }
  },
  buildLog: async ({ input, snapshots, ctx }) => {
    const parsed = plannerAvailabilityWeeklyReplaceSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadWeeklySnapshots(em, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
    })
    const before = (snapshots.before as AvailabilityRuleSnapshot[] | undefined) ?? []
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('planner.audit.availability.weekly.replace', 'Replace weekly availability'),
      resourceKind: AVAILABILITY_RULE_RESOURCE_KIND,
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
      context: parsed.subjectType === 'ruleset'
        ? { cacheAliases: [AVAILABILITY_RULE_SET_CACHE_RESOURCE_KIND] }
        : null,
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

registerCommand(replaceWeeklyAvailabilityCommand)
