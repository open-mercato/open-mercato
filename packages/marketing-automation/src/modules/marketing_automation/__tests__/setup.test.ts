import { z } from 'zod'
import { reportError } from '@open-mercato/telemetry'
import { setup, stableScheduleUuid } from '../setup'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }), { virtual: true })

/**
 * `stableScheduleUuid` slices a sha256 hash into UUID-shaped groups. Earlier it did that without
 * patching the version/variant nibbles, so Postgres accepted the id but the scheduler's own
 * `z.uuid()` validators (update/delete/trigger) rejected it for some hash inputs — an operator
 * could not manage the registered schedule through the admin UI.
 */
describe('stableScheduleUuid()', () => {
  test('always satisfies z.uuid()', () => {
    const uuid = stableScheduleUuid('marketing_automation:due-run-scan:org1')
    expect(z.uuid().safeParse(uuid).success).toBe(true)
  })

  test('matches the RFC 4122 v4 shape', () => {
    const uuid = stableScheduleUuid('marketing_automation:sweep:org1')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('is deterministic — same input produces same output', () => {
    const first = stableScheduleUuid('marketing_automation:due-run-scan:org1')
    const second = stableScheduleUuid('marketing_automation:due-run-scan:org1')
    expect(first).toBe(second)
  })

  test('different keys produce different UUIDs', () => {
    const a = stableScheduleUuid('marketing_automation:due-run-scan:org1')
    const b = stableScheduleUuid('marketing_automation:sweep:org1')
    expect(a).not.toBe(b)
  })
})

describe('schedule setup', () => {
  beforeEach(() => jest.clearAllMocks())

  test('reports registration errors while keeping tenant setup best-effort', async () => {
    const failure = new Error('registration failed')
    const container = {
      hasRegistration: () => true,
      resolve: () => ({ register: jest.fn().mockRejectedValue(failure) }),
    }

    await expect(setup.seedDefaults?.({ container, tenantId: 'tenant', organizationId: 'org' } as never))
      .resolves.toBeUndefined()
    expect(reportError).toHaveBeenCalledWith(failure, {
      module: 'marketing_automation',
      code: 'marketing_automation.schedule_registration_failed',
    })
  })

  test('does not report when the optional scheduler is absent', async () => {
    const container = { hasRegistration: () => false, resolve: jest.fn() }

    await setup.seedDefaults?.({ container, tenantId: 'tenant', organizationId: 'org' } as never)
    expect(container.resolve).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })
})
