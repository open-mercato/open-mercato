import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A guardrail an operator cannot clear is one they switch off.
 *
 * The breaker counts the failure rate over a fixed window, so re-enabling a paused campaign had it paused
 * again on the very next sweep — by the same failures the operator had just dealt with. The only way out was
 * waiting the whole window out, and nothing on the screen said that was what they were waiting for.
 *
 * Asserted against the SQL and the command rather than through a fake, because the fix is which instant the
 * query starts from and a fake entity manager cannot answer `greatest()`.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const breaker = strip(readFileSync(join(__dirname, '..', 'deliverability.ts'), 'utf8'))
const commands = strip(readFileSync(join(__dirname, '..', '..', 'commands', 'campaigns.ts'), 'utf8'))

describe('the deliverability breaker window', () => {
  it('starts at the later of the window edge and the last reset', () => {
    expect(breaker).toContain('greatest(?::timestamptz')
    expect(breaker).toContain('breaker_reset_at')
  })

  it('treats a campaign that was never reset as having only the window', () => {
    // `-infinity` rather than `now()`: a null must mean "no reset", not "reset just now", or a campaign that
    // has never been re-enabled would never trip.
    expect(breaker).toContain("'-infinity'::timestamptz")
  })

  it('stays one grouped query, which is why the reset is joined rather than filtered per campaign', () => {
    // The breaker runs on the periodic sweep; a query per campaign is what it exists to avoid.
    expect(breaker).toContain('group by s.campaign_id')
    expect((breaker.match(/from marketing_message_sends/g) ?? []).length).toBe(1)
  })

  it('scopes the join by tenant and organization, not by id alone', () => {
    expect(breaker).toContain('c.tenant_id = s.tenant_id')
    expect(breaker).toContain('c.organization_id = s.organization_id')
  })
})

describe('what moves the reset', () => {
  it('enabling a campaign does', () => {
    expect(commands).toContain('campaign.breakerResetAt = new Date()')
  })

  it('and only enabling — not disabling, and not an unrelated save', () => {
    /**
     * A campaign switched off for an unrelated reason and switched on later should not arrive with a cleared
     * slate it never earned, and `updatedAt` would have cleared the breaker's memory on any edit — a guardrail
     * that stops guarding exactly while somebody is editing.
     */
    // Asserted on the condition rather than on one exact line: the block grew a second statement when the
    // breaker badge was added, and a rule that pins formatting fails on an unrelated edit.
    expect(commands).toContain('if (changed && payload.isEnabled)')
    expect(commands).toContain('campaign.breakerResetAt = new Date()')
    // Enabling clears the automatic-pause badge too, in the same place and for the same reason.
    expect(commands).toContain('campaign.breakerTrippedAt = null')
    expect(commands).not.toContain('breakerResetAt = campaign.updatedAt')
  })
})
