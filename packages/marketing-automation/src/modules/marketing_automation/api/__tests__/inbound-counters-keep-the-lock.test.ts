import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Telemetry about a hook must not advance the version somebody is editing against.
 *
 * The public inbound endpoint loaded the hook entity and flushed it to bump `received_count`, which runs the
 * `onUpdate` hook on `updated_at`. So every POST advanced the optimistic-lock version, and an admin trying
 * to revoke a hook that was receiving traffic got 409 for ever — the version they read was stale before the
 * form had finished rendering. Those three columns are facts ABOUT the hook, not the content under the lock.
 *
 * A structural test rather than a behavioural one: the defect is which API is used, and the behaviour it
 * produces is a timestamp nobody asserts on. Checked against the one file that writes them.
 */
const ROUTE = join(__dirname, '..', 'inbound', 'route.ts')
const source = readFileSync(ROUTE, 'utf8')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('the public inbound endpoint', () => {
  it('writes the counters through SQL rather than a tracked entity', () => {
    expect(code).toContain('update marketing_inbound_hooks')
    expect(code).toContain('received_count = received_count + 1')
  })

  it('never flushes the loaded hook, which is what bumped updated_at', () => {
    expect(/hook\.receivedCount\s*\+=/.test(code)).toBe(false)
    expect(/hook\.lastReceivedAt\s*=/.test(code)).toBe(false)
    expect(/em\.flush\(\)/.test(code)).toBe(false)
  })

  it('does not write updated_at itself either', () => {
    // Setting it by hand would be the same defect spelled differently.
    expect(/updated_at\s*=/.test(code)).toBe(false)
  })

  it('increments in the statement rather than in memory', () => {
    // This is the one endpoint in the module that genuinely runs concurrently with itself.
    expect(code).toContain('received_count = received_count + 1')
  })

  it('scopes the write by tenant and organization', () => {
    expect(code).toContain('tenant_id = ? and organization_id = ?')
  })
})
