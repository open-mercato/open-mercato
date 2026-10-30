import { z } from 'zod'

const reportError = jest.fn()

jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import { setup, stableScheduleUuid } from '../setup'

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

/**
 * `ensureSchedules` is best-effort by design — a missing scheduler, or a failed registration, must
 * never abort tenant setup. It still has to leave a telemetry trail: a `logger.warn` alone produces
 * no `reportError` sample/fingerprint, and a campaign that never sweeps because its schedule was never
 * registered has nothing pointing back at this failure.
 */
describe('marketing_automation setup: schedule registration', () => {
  it('reports a failed registration, and still does not throw', async () => {
    reportError.mockReset()
    const register = jest.fn().mockRejectedValue(new Error('[internal] scheduler unavailable'))
    const container = {
      hasRegistration: () => true,
      resolve: () => ({ register }),
    }

    await expect(
      setup.seedDefaults!({ container, tenantId: 't1', organizationId: 'o1' } as never),
    ).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledTimes(1)
    const [, options] = reportError.mock.calls[0]
    expect(options).toMatchObject({
      module: 'marketing_automation',
      code: 'marketing_automation.schedule_registration_failed',
      attributes: { tenantId: 't1', organizationId: 'o1' },
    })
  })

  it('reports nothing when there is no scheduler installed at all', async () => {
    reportError.mockReset()
    const container = { hasRegistration: () => false, resolve: jest.fn() }

    await setup.seedDefaults!({ container, tenantId: 't1', organizationId: 'o1' } as never)
    expect(reportError).not.toHaveBeenCalled()
  })
})
