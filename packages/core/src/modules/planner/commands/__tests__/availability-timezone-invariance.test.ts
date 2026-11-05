/** @jest-environment node */

/**
 * Timezone handling for the planner availability write commands (issue #5862).
 *
 * The structured replace endpoints receive the author's wall-clock time
 * (`windows: [{ start: 'HH:MM', … }]`) together with the intended IANA zone
 * (`timezone`) in the same payload. `DTSTART` must be a function of those two
 * inputs ONLY — never of the host process's `TZ`.
 *
 * Before the fix it was a function of the host clock: the builders constructed
 * the instant with the local `Date` constructor and labelled the result `Z`, so
 * the same request persisted a different absolute instant depending on which
 * machine served it.
 *
 * TWO KINDS OF ASSERTION HERE, AND BOTH ARE NEEDED
 *
 * 1. `timezone: 'UTC'` cases pin host-`TZ` invariance. Every helper in
 *    `availabilityTimezone.ts` is the identity transform at UTC, so these stay
 *    correct under either resolution of the semantic fork in #5862 and will not
 *    need rewriting when it is settled.
 * 2. Non-UTC cases pin the behaviour this change actually introduces — that the
 *    DECLARED zone is what anchors the instant. Without these, discarding the
 *    caller's zone entirely (returning UTC unconditionally from
 *    `resolveTimeZone`) leaves group 1 green at every host `TZ`, so the suite
 *    would not detect a regression to zone-blind writes.
 *
 * HOW TO RUN
 *
 * `process.env.TZ` cannot be reassigned mid-run: inside a jest worker the
 * mutation is silently ignored, though the same reassignment does take effect
 * in plain node — which makes this an easy trap. The zone must come from the
 * runner, so this suite is executed twice:
 *
 *     yarn workspace @open-mercato/core test availability-timezone   # America/New_York
 *     yarn workspace @open-mercato/core test:tz                      # Pacific/Auckland
 *
 * (`jest.config.base.cjs` defaults an unset `TZ` to America/New_York.)
 *
 * Both legs run in CI. A suite that only ever ran at `TZ=UTC` passed with this
 * bug fully present, which is precisely why it shipped.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { getMergedAvailabilityWindows } from '../../lib/availabilityMerge'
import { parseAvailabilityRuleWindow } from '../../lib/availabilitySchedule'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string) => key,
  }),
}))

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SUBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const DATE = '2026-06-15'
// 2026-06-15 is a Monday in UTC. Pinned so the weekly weekday anchor, which the
// command derives from "now", is deterministic.
const NOW = '2026-06-15T12:00:00Z'
const MONDAY = 1

const DATE_SPECIFIC = 'planner.availability.date-specific.replace'
const WEEKLY = 'planner.availability.weekly.replace'

function makeEm() {
  const created: Record<string, unknown>[] = []
  const em: Record<string, unknown> = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return { ...data }
    }),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(em)),
    fork() {
      return this
    },
  }
  return { em, created }
}

type StoredRule = Record<string, unknown> & { id: string; deletedAt: Date | null }

function storedRule(id: string, rrule: string, timezone: string, overrides: Record<string, unknown> = {}): StoredRule {
  return {
    id,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'member',
    subjectId: SUBJECT_ID,
    timezone,
    rrule,
    exdates: [],
    kind: 'availability',
    note: null,
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    updatedAt: new Date('2026-06-01T10:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

function matchesWhere(row: StoredRule, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$in' in expected) {
      return (expected as { $in: unknown[] }).$in.includes(row[key])
    }
    return row[key] === expected
  })
}

function makeStoreEm(rows: StoredRule[]) {
  let sequence = 0
  const em: Record<string, unknown> = {
    find: jest.fn(async (_cls: unknown, where: Record<string, unknown>) => rows.filter((row) => matchesWhere(row, where))),
    findOne: jest.fn(async (_cls: unknown, where: Record<string, unknown>) => rows.find((row) => matchesWhere(row, where)) ?? null),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => {
      sequence += 1
      const row: StoredRule = { id: `created-${sequence}`, deletedAt: null, ...data }
      rows.push(row)
      return row
    }),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb(em)),
    fork() {
      return this
    },
  }
  return em
}

function liveRules(rows: StoredRule[]): StoredRule[] {
  return rows.filter((row) => row.deletedAt === null)
}

function makeCtx(em: unknown, headers: Record<string, string> = {}) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/planner/availability', { method: 'POST', headers }),
  }
}

type SnapshotLike = { id: string; rrule: string }

async function replaceAndLog(rows: StoredRule[], input: Record<string, unknown>, headers: Record<string, string> = {}) {
  const em = makeStoreEm(rows)
  const ctx = makeCtx(em, headers)
  const handler = commandRegistry.get(DATE_SPECIFIC)!
  const prepared = (await handler.prepare!(input as never, ctx as never)) as { before: SnapshotLike[] }
  await handler.execute(input as never, ctx as never)
  const log = (await handler.buildLog!({ input, snapshots: prepared, ctx } as never)) as {
    payload: { undo: { before: SnapshotLike[]; after: SnapshotLike[] } }
  }
  const undo = () => handler.undo!({ logEntry: { commandPayload: log.payload }, ctx } as never)
  return { before: log.payload.undo.before, after: log.payload.undo.after, undo }
}

async function persistedRrules(commandId: string, input: Record<string, unknown>): Promise<string[]> {
  const { em, created } = makeEm()
  const handler = commandRegistry.get(commandId)
  expect(handler).toBeTruthy()
  await handler!.execute(input as never, makeCtx(em) as never)
  return created.map((row) => String(row.rrule))
}

function dtStartOf(rrule: string): string {
  const match = rrule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  if (!match?.[1]) throw new Error(`[internal] no DTSTART in rrule: ${rrule}`)
  return match[1]
}

function bydayOf(rrule: string): string | null {
  return rrule.match(/BYDAY=([A-Z]{2})/)?.[1] ?? null
}

function dateSpecificInput(timezone: string, windows: { start: string; end: string }[]) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    // `member` avoids the rule-set optimistic-lock branch; the DTSTART builder
    // under test is shared by every subject type.
    subjectType: 'member',
    subjectId: SUBJECT_ID,
    timezone,
    dates: [DATE],
    windows,
    kind: 'availability',
  }
}

async function persistedWeeklyRrulesAt(now: string, input: Record<string, unknown>): Promise<string[]> {
  jest.useFakeTimers({ now: new Date(now), doNotFake: ['queueMicrotask', 'nextTick'] })
  try {
    return await persistedRrules(WEEKLY, input)
  } finally {
    jest.useRealTimers()
  }
}

const warsawClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function warsawWallClock(instant: Date): string {
  return warsawClock.format(instant).replace(',', '')
}

function warsawWindows(rrule: string, range: { start: string; end: string }): string[] {
  const windows = getMergedAvailabilityWindows({
    rules: [{ id: 'weekly', rrule, timezone: 'Europe/Warsaw', kind: 'availability' }],
    range: { start: new Date(range.start), end: new Date(range.end) },
    respectTimezone: true,
    weeklyScheduleTemplate: true,
  })
  return windows.map((window) => `${warsawWallClock(window.start)} – ${warsawWallClock(window.end)}`)
}

function weeklyInput(timezone: string) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'member',
    subjectId: SUBJECT_ID,
    timezone,
    windows: [{ weekday: MONDAY, start: '09:00', end: '17:00' }],
  }
}

describe(`planner availability writes (host TZ=${process.env.TZ ?? 'unset'})`, () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../availability-date-specific')
    await import('../availability-weekly')
  })

  describe('host-TZ invariance — holds under either resolution of #5862', () => {
    it('date-specific replace anchors the window to the declared zone', async () => {
      const rrules = await persistedRrules(DATE_SPECIFIC, dateSpecificInput('UTC', [{ start: '09:00', end: '17:00' }]))
      expect(rrules.map(dtStartOf)).toEqual(['20260615T090000Z'])
    })

    it('date-specific full-day unavailability starts at midnight in the declared zone', async () => {
      const rrules = await persistedRrules(DATE_SPECIFIC, {
        ...dateSpecificInput('UTC', []),
        isAvailable: false,
        kind: 'unavailability',
      })
      expect(rrules.map(dtStartOf)).toEqual(['20260615T000000Z'])
    })

    it('weekly replace derives the weekday anchor in the declared zone', async () => {
      jest.useFakeTimers({ now: new Date(NOW), doNotFake: ['queueMicrotask', 'nextTick'] })
      try {
        const rrules = await persistedRrules(WEEKLY, weeklyInput('UTC'))
        expect(rrules.map(dtStartOf)).toEqual(['20260615T090000Z'])
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('replace-by-date selects existing rows by their own local date', () => {
    // Auckland 09:00 on 14/15/16 June, stored as UTC instants one day earlier.
    const rowsAroundJune15 = () => [
      storedRule('auckland-14', 'DTSTART:20260613T210000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY;COUNT=1', 'Pacific/Auckland'),
      storedRule('auckland-15', 'DTSTART:20260614T210000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY;COUNT=1', 'Pacific/Auckland'),
      storedRule('auckland-16', 'DTSTART:20260615T210000Z\nDURATION:PT8H\nRRULE:FREQ=DAILY;COUNT=1', 'Pacific/Auckland'),
    ]

    it('replaces only the row that falls on the requested local date and snapshots it', async () => {
      const rows = rowsAroundJune15()
      const { before, after } = await replaceAndLog(
        rows,
        dateSpecificInput('Pacific/Auckland', [{ start: '10:00', end: '12:00' }]),
      )
      expect(before.map((row) => row.id)).toEqual(['auckland-15'])
      expect(liveRules(rows).map((row) => row.id)).toEqual(['auckland-14', 'auckland-16', 'created-1'])
      expect(after.map((row) => row.id)).toEqual(['created-1'])
    })

    it('enforces the aggregate version of the rows on that local date', async () => {
      const rows = rowsAroundJune15()
      rows[1].updatedAt = new Date('2026-06-02T10:00:00Z')
      const stale = { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-01T10:00:00.000Z' }
      const error = await replaceAndLog(
        rows,
        dateSpecificInput('Pacific/Auckland', [{ start: '10:00', end: '12:00' }]),
        stale,
      ).catch((err: unknown) => err)
      expect(isCrudHttpError(error) && error.status).toBe(409)
      expect(liveRules(rows).map((row) => row.id)).toEqual(['auckland-14', 'auckland-15', 'auckland-16'])
    })
  })

  describe('DST transitions resolve the same way on every host', () => {
    const fullDay = (timezone: string, date: string) => ({
      ...dateSpecificInput(timezone, []),
      dates: [date],
      isAvailable: false,
      kind: 'unavailability',
    })

    it('starts a full-day block at the first instant of a date whose midnight is skipped', async () => {
      // Cairo jumps from 00:00 to 01:00 (+2 → +3) on 2026-04-24, so the day is
      // 01:00 local (22:00Z on the 23rd) to the next midnight: 23 hours.
      const rows: StoredRule[] = []
      const { after, undo } = await replaceAndLog(rows, fullDay('Africa/Cairo', '2026-04-24'))
      expect(after.map((row) => row.rrule)).toEqual([
        'DTSTART:20260423T220000Z\nDURATION:PT23H\nRRULE:FREQ=DAILY;COUNT=1',
      ])

      const resave = await replaceAndLog(rows, fullDay('Africa/Cairo', '2026-04-24'))
      expect(resave.before.map((row) => row.id)).toEqual(['created-1'])
      expect(liveRules(rows)).toHaveLength(1)

      await resave.undo()
      await undo()
      expect(liveRules(rows)).toHaveLength(0)
    })

    it('resolves a repeated wall time to its earlier occurrence', async () => {
      // Warsaw repeats 02:00–03:00 on 2026-10-25 (+2 → +1). 02:30 is taken in
      // CEST (00:30Z); 03:30 only exists in CET (02:30Z).
      const rrules = await persistedRrules(DATE_SPECIFIC, {
        ...dateSpecificInput('Europe/Warsaw', [{ start: '02:30', end: '03:30' }]),
        dates: ['2026-10-25'],
      })
      expect(rrules).toEqual(['DTSTART:20261025T003000Z\nDURATION:PT2H\nRRULE:FREQ=DAILY;COUNT=1'])
    })
  })

  describe('the declared zone is what anchors the instant', () => {
    it('anchors a Europe/Warsaw window at that zone offset, not UTC and not the host', async () => {
      const rrules = await persistedRrules(
        DATE_SPECIFIC,
        dateSpecificInput('Europe/Warsaw', [{ start: '09:00', end: '17:00' }]),
      )
      // 09:00 CEST (+2) === 07:00Z. Discarding the zone would yield 09:00Z.
      expect(rrules.map(dtStartOf)).toEqual(['20260615T070000Z'])
    })

    it('anchors a Pacific/Auckland window onto the previous UTC day', async () => {
      const rrules = await persistedRrules(
        DATE_SPECIFIC,
        dateSpecificInput('Pacific/Auckland', [{ start: '09:00', end: '17:00' }]),
      )
      // 09:00 NZST (+12) on the 15th is 21:00Z on the 14th — a different
      // calendar date, which no same-day assertion can catch.
      expect(rrules.map(dtStartOf)).toEqual(['20260614T210000Z'])
    })

    it('anchors a full-day Europe/Warsaw block to that zone midnight', async () => {
      const rrules = await persistedRrules(DATE_SPECIFIC, {
        ...dateSpecificInput('Europe/Warsaw', []),
        isAvailable: false,
        kind: 'unavailability',
      })
      // Midnight in Warsaw is 22:00Z the previous day. The UTC-only expander
      // therefore reads this row as the 14th — a known layer-2 consequence
      // tracked in #5862, pinned here so the shift is visible rather than
      // rediscovered as a fresh defect.
      expect(rrules.map(dtStartOf)).toEqual(['20260614T220000Z'])
    })

    it('resolves the weekly anchor and BYDAY in the declared zone, across a UTC day boundary', async () => {
      jest.useFakeTimers({ now: new Date(NOW), doNotFake: ['queueMicrotask', 'nextTick'] })
      try {
        const rrules = await persistedRrules(WEEKLY, weeklyInput('Pacific/Auckland'))
        expect(rrules).toHaveLength(1)
        // At 12:00Z Monday it is already Tuesday in Auckland, so the next
        // Monday is the 22nd — 09:00 there is 21:00Z on Sunday the 21st.
        // Host-clock arithmetic picked a different week entirely.
        expect(dtStartOf(rrules[0])).toBe('20260621T210000Z')
        // BYDAY is zone-relative by design: a UTC Sunday DTSTART carrying
        // BYDAY=MO. See the note in `buildWeeklyRrule`.
        expect(bydayOf(rrules[0])).toBe('MO')
      } finally {
        jest.useRealTimers()
      }
    })

    it('keeps the window duration intact when the zone shifts the anchor', async () => {
      const rrules = await persistedRrules(
        DATE_SPECIFIC,
        dateSpecificInput('Pacific/Auckland', [{ start: '09:00', end: '17:00' }]),
      )
      expect(rrules[0]).toContain('DURATION:PT8H')
    })
  })

  describe('a weekly window keeps its local end across DST, from command to consumer', () => {
    const SUNDAY = 0
    const sundayNight = {
      ...weeklyInput('Europe/Warsaw'),
      windows: [{ weekday: SUNDAY, start: '00:00', end: '08:00' }],
    }

    it('preserves both requested wall times when the upcoming window lies entirely inside a gap', async () => {
      const gapWindow = {
        ...weeklyInput('Europe/Warsaw'),
        windows: [{ weekday: SUNDAY, start: '02:00', end: '02:30' }],
      }
      const [duringTransitionWeek] = await persistedWeeklyRrulesAt('2026-03-25T10:00:00Z', gapWindow)
      const [weekAfter] = await persistedWeeklyRrulesAt('2026-04-01T10:00:00Z', gapWindow)
      const range = { start: '2026-04-04T22:00:00Z', end: '2026-04-06T00:00:00Z' }

      expect(dtStartOf(duringTransitionWeek)).toBe('20260322T010000Z')
      expect(warsawWindows(duringTransitionWeek, range)).toEqual(['2026-04-05 02:00 – 2026-04-05 02:30'])
      expect(warsawWindows(duringTransitionWeek, range)).toEqual(warsawWindows(weekAfter, range))
    })

    it('does not let an anchor week spanning the autumn fallback stretch every week to 9 hours', async () => {
      // Saved on Wednesday 2026-10-21: the upcoming Sunday 00:00–08:00 spans
      // the 2026-10-25 fallback (03:00 CEST → 02:00 CET) and lasts 9 hours,
      // which used to persist PT9H and open every later Sunday until 09:00.
      const [rrule] = await persistedWeeklyRrulesAt('2026-10-21T10:00:00Z', sundayNight)
      expect(rrule).toContain('DURATION:PT8H')
      // Anchored one week earlier, on an ordinary Sunday (00:00 CEST = 22:00Z).
      expect(dtStartOf(rrule)).toBe('20261017T220000Z')

      const window = parseAvailabilityRuleWindow({ id: 'weekly', rrule })
      expect(window.endAt.getTime() - window.startAt.getTime()).toBe(8 * 60 * 60 * 1000)

      expect(warsawWindows(rrule, { start: '2026-10-24T00:00:00Z', end: '2026-11-03T00:00:00Z' })).toEqual([
        '2026-10-25 00:00 – 2026-10-25 08:00',
        '2026-11-01 00:00 – 2026-11-01 08:00',
      ])
    })

    it('stores the same schedule whichever week it is saved in', async () => {
      const duringTransitionWeek = await persistedWeeklyRrulesAt('2026-10-21T10:00:00Z', sundayNight)
      const weekAfter = await persistedWeeklyRrulesAt('2026-10-28T10:00:00Z', sundayNight)
      const range = { start: '2026-10-24T00:00:00Z', end: '2026-11-10T00:00:00Z' }
      expect(warsawWindows(weekAfter[0], range)).toEqual(warsawWindows(duringTransitionWeek[0], range))
      expect(weekAfter[0]).toContain('DURATION:PT8H')
    })

    it('ends the spring-forward Sunday at the requested local time too', async () => {
      // 2025-03-30 skips 02:00–03:00 in Warsaw, so 00:00–08:00 lasts 7 hours
      // that day. Adding the stored 8 hours as an exact span opened the window
      // until 09:00.
      const [rrule] = await persistedWeeklyRrulesAt('2025-03-19T10:00:00Z', sundayNight)
      expect(rrule).toContain('DURATION:PT8H')
      expect(warsawWindows(rrule, { start: '2025-03-29T00:00:00Z', end: '2025-04-07T00:00:00Z' })).toEqual([
        '2025-03-30 00:00 – 2025-03-30 08:00',
        '2025-04-06 00:00 – 2025-04-06 08:00',
      ])
    })
  })
})
