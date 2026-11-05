/** @jest-environment node */

/**
 * Aggregate optimistic locking for the planner date-specific availability
 * replace command (issue #3279).
 *
 * `planner.availability.date-specific.replace` soft-deletes the active one-off
 * rules for the targeted subject/date(s) and creates replacements. It is a
 * Command-pattern write that never reaches the CRUD guard, so without a
 * command-level check two users editing the same subject/date silently
 * last-write-wins. The aggregate has no single parent row, so the version is
 * derived from the max `updated_at` of the one-off rules being replaced; the
 * client sends that token via the optimistic-lock extension header. On mismatch
 * the command throws the structured 409 BEFORE replacing any rows. Strictly
 * additive: no header → no 409.
 */

import { createContainer, asValue, InjectionMode } from 'awilix'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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
const RULE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const DATE = '2026-06-15'
const CURRENT = '2026-05-25T08:42:20.999Z'
const STALE = '2026-05-25T08:42:18.123Z'

// Mirror the command's own DTSTART builder so the rule round-trips to the same
// local calendar day under `parseAvailabilityRuleWindow` + `formatDateKey`
// regardless of the host timezone (local noon is stable across all offsets).
function buildOnceRrule(date: string, time = '12:00'): string {
  const [year, month, day] = date.split('-').map((part) => Number(part))
  const [hours, minutes] = time.split(':').map((part) => Number(part))
  const start = new Date(year, month - 1, day, hours, minutes, 0, 0)
  const dtStart = start.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  return `DTSTART:${dtStart}\nDURATION:PT1H\nRRULE:FREQ=DAILY;COUNT=1`
}

function makeExistingRule(updatedAt: string) {
  return {
    id: RULE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    subjectType: 'ruleset',
    subjectId: SUBJECT_ID,
    timezone: 'UTC',
    rrule: buildOnceRrule(DATE),
    exdates: [],
    kind: 'availability',
    note: null,
    unavailabilityReasonEntryId: null,
    unavailabilityReasonValue: null,
    createdAt: new Date(CURRENT),
    updatedAt: new Date(updatedAt),
    deletedAt: null,
  }
}

function makeEm(existing: unknown[]) {
  const em: Record<string, unknown> = {
    find: jest.fn(async () => existing),
    create: jest.fn((_cls: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => undefined),
    flush: jest.fn(async () => undefined),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<void>) => {
      await cb(em)
    }),
    fork() {
      return this
    },
  }
  return em
}

function makeRequest(headerValue: string | null): Request {
  const headers = new Headers()
  if (headerValue != null) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, headerValue)
  return new Request('https://example.test/api/planner/availability-date-specific', {
    method: 'POST',
    headers,
  })
}

function makeCtx(em: unknown, request: Request) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({ em: asValue(em) })
  return {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID, sub: 'user-1' },
    selectedOrganizationId: ORG_ID,
    organizationScope: null,
    organizationIds: null,
    request,
  }
}

const baseInput = {
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  subjectType: 'ruleset',
  subjectId: SUBJECT_ID,
  timezone: 'UTC',
  dates: [DATE],
  windows: [{ start: '09:00', end: '17:00' }],
  kind: 'availability',
}

describe('planner.availability.date-specific.replace — aggregate optimistic lock', () => {
  beforeAll(async () => {
    commandRegistry.clear?.()
    await import('../availability-date-specific')
  })

  it('rejects a stale aggregate version with a 409 before replacing rows', async () => {
    const em = makeEm([makeExistingRule(CURRENT)])
    const ctx = makeCtx(em, makeRequest(STALE))
    const handler = commandRegistry.get('planner.availability.date-specific.replace')
    expect(handler).toBeTruthy()

    let caught: unknown
    try {
      await handler!.execute(baseInput, ctx as never)
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect((caught as CrudHttpError).body).toMatchObject({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: CURRENT,
      expectedUpdatedAt: STALE,
    })
    // Proves the check fires before mutation: no replacement rows were created.
    expect(em.create).not.toHaveBeenCalled()
  })

  it('passes when the header matches the aggregate version', async () => {
    const em = makeEm([makeExistingRule(CURRENT)])
    const ctx = makeCtx(em, makeRequest(CURRENT))
    const handler = commandRegistry.get('planner.availability.date-specific.replace')

    await expect(handler!.execute(baseInput, ctx as never)).resolves.toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no header — strictly additive', async () => {
    const em = makeEm([makeExistingRule(CURRENT)])
    const ctx = makeCtx(em, makeRequest(null))
    const handler = commandRegistry.get('planner.availability.date-specific.replace')

    await expect(handler!.execute(baseInput, ctx as never)).resolves.toEqual({ ok: true })
  })
})
