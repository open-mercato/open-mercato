import { z } from 'zod'
import { stableScheduleUuid } from '../setup'

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
