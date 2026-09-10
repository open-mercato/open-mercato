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
 *     yarn workspace @open-mercato/core test availability-timezone   # TZ=UTC
 *     yarn workspace @open-mercato/core test:tz                      # non-UTC
 *
 * Both legs run in CI. A suite that only ever ran at `TZ=UTC` passed with this
 * bug fully present, which is precisely why it shipped.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

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

function makeCtx(em: unknown) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request: new Request('https://example.test/api/planner/availability', { method: 'POST' }),
  }
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
})
