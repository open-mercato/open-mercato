import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PlannerAvailabilityRule, PlannerAvailabilityRuleSet } from '../data/entities'

export type PlannerSeedScope = { tenantId: string; organizationId: string }

type WorkingHours = { startHour: number; startMinute: number; endHour: number; endMinute: number }

const DEFAULT_AVAILABILITY_RULESET_TIMEZONE = 'UTC'
const DEFAULT_WORKING_HOURS: WorkingHours = { startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }
const WEEKEND_WORKING_HOURS: WorkingHours = { startHour: 10, startMinute: 0, endHour: 14, endMinute: 0 }

const AVAILABILITY_RULESET_SEEDS = [
  {
    name: 'Normal working hours',
    description: 'Standard working hours: Monday-Friday, 09:00-17:00.',
    timezone: DEFAULT_AVAILABILITY_RULESET_TIMEZONE,
    weekdays: [1, 2, 3, 4, 5],
    hours: DEFAULT_WORKING_HOURS,
  },
  {
    name: 'Weekends',
    description: 'Weekend availability: Saturday-Sunday, 10:00-14:00.',
    timezone: DEFAULT_AVAILABILITY_RULESET_TIMEZONE,
    weekdays: [0, 6],
    hours: WEEKEND_WORKING_HOURS,
  },
] as const

function formatDuration(minutes: number): string {
  const clamped = Math.max(1, minutes)
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`
  if (hours > 0) return `PT${hours}H`
  return `PT${mins}M`
}

function buildAvailabilityRrule(start: Date, end: Date, weekdayCode: string): string {
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const duration = formatDuration(durationMinutes)
  const rule = `FREQ=WEEKLY;BYDAY=${weekdayCode}`
  return `DTSTART:${dtStart}\nDURATION:${duration}\nRRULE:${rule}`
}

function weekdayCodeForIndex(index: number): string {
  const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  return codes[index] ?? 'MO'
}

function buildWeeklyRuleForWeekday(weekdayIndex: number, hours: WorkingHours): string {
  const baseMonday = Date.UTC(2025, 0, 6, 0, 0, 0)
  const offsetDays = (weekdayIndex - 1 + 7) % 7
  const start = new Date(baseMonday + offsetDays * 24 * 60 * 60 * 1000)
  start.setUTCHours(hours.startHour, hours.startMinute, 0, 0)
  const end = new Date(baseMonday + offsetDays * 24 * 60 * 60 * 1000)
  end.setUTCHours(hours.endHour, hours.endMinute, 0, 0)
  return buildAvailabilityRrule(start, end, weekdayCodeForIndex(weekdayIndex))
}

export async function seedPlannerAvailabilityRuleSetDefaults(
  em: EntityManager,
  scope: PlannerSeedScope,
) {
  const now = new Date()
  for (const seed of AVAILABILITY_RULESET_SEEDS) {
    const existing = await findWithDecryption(
      em,
      PlannerAvailabilityRuleSet,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: seed.name,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const ruleSet = existing[0] ?? em.create(PlannerAvailabilityRuleSet, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      name: seed.name,
      description: seed.description,
      timezone: seed.timezone,
      createdAt: now,
      updatedAt: now,
    })
    if (!existing[0]) {
      em.persist(ruleSet)
      await em.flush()
    }

    const rules = await findWithDecryption(
      em,
      PlannerAvailabilityRule,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        subjectType: 'ruleset',
        subjectId: ruleSet.id,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    const existingByRrule = new Set(rules.map((rule) => rule.rrule))
    for (const weekday of seed.weekdays) {
      const rrule = buildWeeklyRuleForWeekday(weekday, seed.hours)
      if (existingByRrule.has(rrule)) continue
      const rule = em.create(PlannerAvailabilityRule, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        subjectType: 'ruleset',
        subjectId: ruleSet.id,
        timezone: seed.timezone,
        rrule,
        exdates: [],
        kind: 'availability',
        note: null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(rule)
    }
    await em.flush()
  }
}
